package dev.nimbus.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.provider.Settings;
import android.webkit.CookieManager;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

import javax.net.ssl.HttpsURLConnection;

/**
 * App updates from your own Nimbus server: android/build.sh publishes /nimbus.apk and /nimbus-apk.json
 * (version + SHA-256). The app checks on start (at most every 6 hours) and from the menu, downloads over the
 * pinned connection, checks the hash, and hands it to Android's installer (one tap to confirm; Android
 * also refuses any APK not signed with the same key).
 */
final class Updater {
    static final String ACTION_DONE = "dev.nimbus.app.INSTALL_DONE";
    private static volatile boolean busy = false;

    private static HttpURLConnection open(Context c, String path) throws Exception {
        String base = Trust.serverUrl(c);
        URL url = new URL(base + path);
        HttpURLConnection h = (HttpURLConnection) url.openConnection();
        if (h instanceof HttpsURLConnection) {
            ((HttpsURLConnection) h).setSSLSocketFactory(Trust.socketFactory(c, url.getHost()));
            ((HttpsURLConnection) h).setHostnameVerifier(Trust.PINNED_HOST);
        }
        h.setConnectTimeout(8000); h.setReadTimeout(30000);
        String cookie = CookieManager.getInstance().getCookie(base);
        if (cookie != null) h.setRequestProperty("Cookie", cookie);
        return h;
    }

    static long installedVersion(Context c) {
        try { return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).getLongVersionCode(); } catch (Exception e) { return 0; }
    }

    /** manual: from the menu (always says something); otherwise quiet unless an update is there. */
    static void check(Activity a, boolean manual) {
        if (!manual) {
            long last = Trust.prefs(a).getLong("updateCheck", 0);
            if (System.currentTimeMillis() - last < 6 * 3600_000L) return;
        }
        if (busy) return;
        new Thread(() -> {
            try {
                HttpURLConnection h = open(a, "/nimbus-apk.json");
                if (h.getResponseCode() != 200) throw new Exception("server answered " + h.getResponseCode());
                JSONObject j = new JSONObject(read(h.getInputStream()));
                Trust.prefs(a).edit().putLong("updateCheck", System.currentTimeMillis()).apply();
                long code = j.optLong("versionCode"), mine = installedVersion(a);
                String name = j.optString("versionName"), sha = j.optString("sha256");
                a.runOnUiThread(() -> {
                    if (a.isFinishing()) return;
                    if (code <= mine) { if (manual) toast(a, "Nimbus is up to date (" + currentName(a) + ")"); return; }
                    if (!manual && String.valueOf(code).equals(Trust.prefs(a).getString("updateSkip", ""))) return;
                    new AlertDialog.Builder(a).setTitle("Update available")
                        .setMessage("Nimbus " + name + " is ready (you have " + currentName(a) + "). Install it now?")
                        .setPositiveButton("Update", (d, w) -> download(a, sha))
                        .setNegativeButton("Later", (d, w) -> Trust.prefs(a).edit().putString("updateSkip", String.valueOf(code)).apply())
                        .show();
                });
            } catch (Exception e) {
                if (manual) a.runOnUiThread(() -> toast(a, "Couldn't check for updates: " + e.getMessage()));
            }
        }).start();
    }

    private static void download(Activity a, String sha) {
        if (!a.getPackageManager().canRequestPackageInstalls()) {
            toast(a, "Allow Nimbus to install updates, then tap Update again");
            a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName())));
            Trust.prefs(a).edit().remove("updateCheck").remove("updateSkip").apply(); // ask again on return
            return;
        }
        busy = true;
        toast(a, "Downloading the update…");
        new Thread(() -> {
            PackageInstaller pi = a.getPackageManager().getPackageInstaller();
            int sid = -1;
            try {
                HttpURLConnection h = open(a, "/nimbus.apk");
                if (h.getResponseCode() != 200) throw new Exception("server answered " + h.getResponseCode());
                PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                p.setAppPackageName(a.getPackageName());
                sid = pi.createSession(p);
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                try (PackageInstaller.Session s = pi.openSession(sid)) {
                    try (InputStream in = h.getInputStream(); OutputStream out = s.openWrite("nimbus.apk", 0, -1)) {
                        byte[] b = new byte[65536]; int n;
                        while ((n = in.read(b)) > 0) { out.write(b, 0, n); md.update(b, 0, n); }
                        s.fsync(out);
                    }
                    String got = hex(md.digest());
                    if (sha != null && !sha.isEmpty() && !sha.equalsIgnoreCase(got)) throw new Exception("the download was damaged (checksum mismatch)");
                    Intent done = new Intent(a, MainActivity.class).setAction(ACTION_DONE);
                    PendingIntent pend = PendingIntent.getActivity(a, sid, done, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
                    s.commit(pend.getIntentSender());
                }
            } catch (Exception e) {
                if (sid >= 0) try { pi.abandonSession(sid); } catch (Exception ignored) {}
                a.runOnUiThread(() -> toast(a, "Update failed: " + e.getMessage()));
            } finally { busy = false; }
        }).start();
    }

    /** MainActivity.onNewIntent: Android asks the user to confirm, or reports the result. */
    static void onInstallStatus(Activity a, Intent i) {
        int st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = i.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
            if (confirm != null) a.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } else if (st != PackageInstaller.STATUS_SUCCESS) {
            String msg = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            if (st != PackageInstaller.STATUS_FAILURE_ABORTED) toast(a, "Update not installed" + (msg != null ? ": " + msg : ""));
        }
    }

    private static String currentName(Context c) {
        try { return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }
    private static String read(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] b = new byte[4096]; int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
        return out.toString("UTF-8");
    }
    private static String hex(byte[] d) { StringBuilder s = new StringBuilder(); for (byte x : d) s.append(String.format("%02x", x)); return s.toString(); }
    private static void toast(Context c, String m) { Toast.makeText(c, m, Toast.LENGTH_LONG).show(); }
}
