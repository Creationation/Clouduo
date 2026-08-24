package com.creationation.clouduo;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Enregistrement dans la pellicule du téléphone.
 *
 * Le bouton de téléchargement de la page passait par un lien HTML, et un
 * navigateur ne sait écrire que dans « Téléchargements »: une photo récupérée
 * n'apparaissait donc jamais dans la Galerie, il fallait aller la chercher
 * dans le gestionnaire de fichiers. Seul MediaStore range un média là où
 * l'appareil photo le range, et MediaStore est une interface native.
 *
 * On passe l'URL signée au natif plutôt que les octets: une vidéo de deux
 * giga-octets traversant le pont en base64 ferait exploser la mémoire de la
 * WebView. L'URL est déjà valable une heure et n'a besoin d'aucun en-tête,
 * donc le natif peut télécharger directement.
 *
 * Aucune permission demandée: depuis Android 10, écrire un média que l'app
 * vient de créer se fait sans autorisation (stockage cloisonné). Sur plus
 * ancien, on refuse proprement et la page retombe sur le téléchargement
 * classique plutôt que de réclamer un accès à toute la mémoire.
 */
@CapacitorPlugin(name = "MediaSave")
public class MediaSavePlugin extends Plugin {

    /** Sous-dossier visible dans la Galerie. */
    private static final String ALBUM = "BubuCloud";

    private static final int BUF = 256 * 1024;

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject r = new JSObject();
        r.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q);
        call.resolve(r);
    }

    @PluginMethod
    public void saveFromUrl(PluginCall call) {
        final String url = call.getString("url");
        final String name = call.getString("name", "fichier");
        final String mime = call.getString("mime", "");
        if (url == null || url.isEmpty()) {
            call.reject("url manquante");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("unsupported");
            return;
        }

        // Réseau et écriture disque: jamais sur le thread principal, sinon
        // l'interface se figerait le temps du transfert.
        new Thread(() -> run(call, url, name, mime == null ? "" : mime)).start();
    }

    private void run(PluginCall call, String url, String name, String mime) {
        ContentResolver cr = getContext().getContentResolver();
        boolean video = mime.startsWith("video/");
        Uri collection = video
                ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                : MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);

        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        if (!mime.isEmpty()) values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(
                MediaStore.MediaColumns.RELATIVE_PATH,
                (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/" + ALBUM);
        // IS_PENDING cache l'entrée tant que l'écriture n'est pas finie: sans
        // ça, une coupure réseau laisserait une vignette vide dans la Galerie.
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri item = null;
        HttpURLConnection conn = null;
        try {
            item = cr.insert(collection, values);
            if (item == null) throw new IOException("la galerie a refusé l'écriture");

            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(30_000);
            conn.setReadTimeout(60_000);
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("HTTP " + code);

            try (InputStream in = conn.getInputStream();
                 OutputStream out = cr.openOutputStream(item)) {
                if (out == null) throw new IOException("flux d'écriture indisponible");
                byte[] buf = new byte[BUF];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                out.flush();
            }

            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(item, values, null, null);

            JSObject r = new JSObject();
            r.put("uri", item.toString());
            call.resolve(r);
        } catch (Exception e) {
            // Ne rien laisser derrière: une entrée à moitié écrite polluerait
            // la Galerie sans que personne comprenne d'où elle vient.
            if (item != null) {
                try {
                    cr.delete(item, null, null);
                } catch (Exception ignored) {
                }
            }
            String msg = e.getMessage();
            call.reject(msg == null ? "enregistrement impossible" : msg);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
