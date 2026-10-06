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
 * Enregistrement sur le téléphone, sans jamais sortir de l'application.
 *
 * Le bouton passait par un lien HTML. Une WebView ne sait pas écrire un
 * fichier: elle délègue au navigateur, qui ouvre l'adresse de stockage et
 * dépose le fichier dans « Téléchargements ». On sortait donc de l'app, on
 * voyait passer une adresse technique, et la photo n'arrivait jamais dans la
 * Galerie. Ici tout se fait à l'intérieur: le natif télécharge lui-même et
 * écrit via MediaStore, la seule interface qui range un média là où
 * l'appareil photo le range.
 *
 * Photo et vidéo vont dans la pellicule, album « BubuCloud ». Un document n'a
 * rien à faire dans la Galerie: il va dans Téléchargements, mais toujours
 * écrit par l'app, sans passer par le navigateur.
 *
 * Le fichier est rangé à sa date de prise de vue, celle que connaît le cloud
 * (`takenAt`), comme une photo prise avec l'appareil. Sans elle, MediaStore
 * lisait l'EXIF quand il existe et, pour une image WhatsApp qui n'en a pas,
 * prenait l'instant de la copie. Seul l'index de la galerie est concerné: les
 * octets ne sont pas touchés.
 *
 * On passe l'URL signée au natif plutôt que les octets: une vidéo de deux
 * giga-octets traversant le pont en base64 ferait exploser la mémoire de la
 * WebView. L'URL est déjà valable une heure et n'a besoin d'aucun en-tête.
 *
 * Aucune permission demandée: depuis Android 10, écrire un fichier que l'app
 * vient de créer se fait sans autorisation (stockage cloisonné).
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

    /**
     * Ou ranger ce fichier: pellicule pour une photo ou une video, dossier
     * Telechargements pour le reste (un PDF n'a rien a faire dans la Galerie,
     * mais il ne doit pas pour autant sortir de l'application pour arriver
     * sur le telephone).
     */
    private static final int PHOTO = 0;
    private static final int VIDEO = 1;
    private static final int DOC = 2;

    private static int destinationFor(String mime) {
        if (mime.startsWith("image/")) return PHOTO;
        if (mime.startsWith("video/")) return VIDEO;
        return DOC;
    }

    @PluginMethod
    public void saveFromUrl(PluginCall call) {
        final String url = call.getString("url");
        final String name = call.getString("name", "fichier");
        final String mime = call.getString("mime", "");
        // Date de prise de vue en millisecondes, absente si le cloud l'ignore.
        final Long takenAt = call.getLong("takenAt");
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
        new Thread(() -> run(call, url, name, mime == null ? "" : mime, takenAt)).start();
    }

    private void run(PluginCall call, String url, String name, String mime, Long takenAt) {
        ContentResolver cr = getContext().getContentResolver();
        int dest = destinationFor(mime);

        Uri collection;
        String folder;
        switch (dest) {
            case VIDEO:
                collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                folder = Environment.DIRECTORY_MOVIES + "/" + ALBUM;
                break;
            case DOC:
                collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                folder = Environment.DIRECTORY_DOWNLOADS + "/" + ALBUM;
                break;
            default:
                collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                folder = Environment.DIRECTORY_PICTURES + "/" + ALBUM;
                break;
        }

        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        if (!mime.isEmpty()) values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, folder);
        // IS_PENDING cache l'entrée tant que l'écriture n'est pas finie: sans
        // ça, une coupure réseau laisserait une vignette vide dans la Galerie.
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri item = null;
        HttpURLConnection conn = null;
        boolean inGallery = dest != DOC;
        try {
            try {
                item = cr.insert(collection, values);
            } catch (IllegalArgumentException bad) {
                // MediaStore refuse un type qu'il ne reconnait pas pour cette
                // collection (un HEIC exotique, un MIME generique). Plutot que
                // d'echouer, on range le fichier dans Telechargements: mieux
                // vaut sur le telephone qu'introuvable.
                if (dest == DOC) throw bad;
                inGallery = false;
                values.put(
                        MediaStore.MediaColumns.RELATIVE_PATH,
                        Environment.DIRECTORY_DOWNLOADS + "/" + ALBUM);
                values.remove(MediaStore.MediaColumns.MIME_TYPE);
                item = cr.insert(
                        MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                        values);
            }
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

            // Ranger le fichier a sa date de prise de vue.
            //
            // Ce n'est pas gagne d'avance: quand IS_PENDING retombe a zero,
            // MediaStore analyse le fichier et remplit DATE_TAKEN depuis
            // l'EXIF, ecrasant ce qu'on aurait mis a l'insertion. On repasse
            // donc APRES l'analyse. Sans date connue, on laisse MediaStore
            // faire.
            if (takenAt != null && takenAt > 0) {
                ContentValues when = new ContentValues();
                if (dest != DOC) when.put(MediaStore.MediaColumns.DATE_TAKEN, takenAt);
                when.put(MediaStore.MediaColumns.DATE_MODIFIED, takenAt / 1000);
                try {
                    cr.update(item, when, null, null);
                } catch (Exception ignored) {
                    // Classement au pire a la date lue par MediaStore: le
                    // fichier est enregistre, c'est l'essentiel.
                }
            }

            JSObject r = new JSObject();
            r.put("uri", item.toString());
            r.put("gallery", inGallery);
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
