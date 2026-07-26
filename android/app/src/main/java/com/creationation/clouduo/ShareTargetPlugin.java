package com.creationation.clouduo;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Réception du partage Android.
 *
 * La WebView affiche un site DISTANT (server.url), pas des fichiers embarqués.
 * Une URI content:// reçue par l'intention n'est donc lisible ni en JavaScript
 * ni par la page. On copie chaque fichier partagé dans le cache de l'app, puis
 * on l'expose à la page morceau par morceau en base64.
 *
 * Le découpage n'est pas une élégance: passer une vidéo entière d'un coup par
 * le pont natif fait exploser la mémoire. Côté web, les morceaux sont
 * réassemblés en Blob, que Chromium stocke sur disque et non en RAM.
 */
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {

    /** Fichiers copiés en attente de récupération par la page. */
    private static final List<JSObject> pending = new ArrayList<>();

    @Override
    public void load() {
        handleIntent(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (action == null) return;

        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) uris.add(uri);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        } else {
            return;
        }
        if (uris.isEmpty()) return;

        // La copie doit se faire maintenant: la permission de lecture accordée
        // sur l'URI ne survit pas à la fin de l'intention.
        JSArray files = new JSArray();
        for (Uri uri : uris) {
            JSObject f = copyToCache(uri, intent.getType());
            if (f != null) {
                pending.add(f);
                files.put(f);
            }
        }
        if (files.length() == 0) return;

        JSObject payload = new JSObject();
        payload.put("files", files);
        notifyListeners("shareReceived", payload, true);
    }

    private JSObject copyToCache(Uri uri, String fallbackMime) {
        ContentResolver cr = getContext().getContentResolver();
        String name = "partage";
        long size = 0;

        try (Cursor c = cr.query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int iName = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int iSize = c.getColumnIndex(OpenableColumns.SIZE);
                if (iName >= 0 && !c.isNull(iName)) name = c.getString(iName);
                if (iSize >= 0 && !c.isNull(iSize)) size = c.getLong(iSize);
            }
        } catch (Exception ignored) {
            // Certains fournisseurs refusent la requête: on garde les valeurs
            // par défaut, la taille réelle est relue après copie.
        }

        String mime = cr.getType(uri);
        if (mime == null) mime = fallbackMime != null ? fallbackMime : "application/octet-stream";

        String id = UUID.randomUUID().toString();
        File dir = new File(getContext().getCacheDir(), "share");
        if (!dir.exists() && !dir.mkdirs()) return null;
        File dest = new File(dir, id);

        try (InputStream in = cr.openInputStream(uri);
             FileOutputStream out = new FileOutputStream(dest)) {
            if (in == null) return null;
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        } catch (Exception e) {
            dest.delete();
            return null;
        }

        JSObject f = new JSObject();
        f.put("id", id);
        f.put("name", name);
        f.put("mime", mime);
        f.put("size", dest.length() > 0 ? dest.length() : size);
        return f;
    }

    /**
     * Le partage peut réveiller l'app avant que la page ait eu le temps de
     * s'abonner à l'événement. La page réclame donc aussi la liste au
     * démarrage, sinon les fichiers seraient perdus.
     */
    @PluginMethod
    public void getPending(PluginCall call) {
        JSArray files = new JSArray();
        for (JSObject f : pending) files.put(f);
        JSObject ret = new JSObject();
        ret.put("files", files);
        call.resolve(ret);
    }

    @PluginMethod
    public void readChunk(PluginCall call) {
        String id = call.getString("id");
        int offset = call.getInt("offset", 0);
        int length = call.getInt("length", 1024 * 1024);
        if (id == null) {
            call.reject("id manquant");
            return;
        }
        File src = new File(new File(getContext().getCacheDir(), "share"), id);
        if (!src.exists()) {
            call.reject("fichier introuvable");
            return;
        }
        try (FileInputStream in = new FileInputStream(src)) {
            long skipped = in.skip(offset);
            if (skipped < offset) {
                call.reject("lecture hors limites");
                return;
            }
            byte[] buf = new byte[length];
            int n = in.read(buf);
            JSObject ret = new JSObject();
            if (n <= 0) {
                ret.put("data", "");
                ret.put("eof", true);
            } else {
                byte[] slice = n == length ? buf : java.util.Arrays.copyOf(buf, n);
                ret.put("data", Base64.encodeToString(slice, Base64.NO_WRAP));
                ret.put("eof", offset + n >= src.length());
            }
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /** Libère le cache une fois le fichier repris par la page. */
    @PluginMethod
    public void release(PluginCall call) {
        String id = call.getString("id");
        if (id != null) {
            new File(new File(getContext().getCacheDir(), "share"), id).delete();
            pending.removeIf(f -> id.equals(f.getString("id")));
        }
        call.resolve();
    }
}
