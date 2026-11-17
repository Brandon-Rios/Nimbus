package dev.nimbus.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.webkit.CookieManager;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;

/** Home-screen widget: homelab up/down, approvals waiting and bots working, from /api/extras/widget. */
public class StatusWidget extends AppWidgetProvider {
    static final String REFRESH = "dev.nimbus.app.WIDGET_REFRESH";

    @Override public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) { refresh(ctx); }

    @Override public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        if (REFRESH.equals(intent.getAction())) refresh(ctx);
    }

    /** Also called by EventService when approvals change, so the count stays current. */
    static void refresh(Context ctx) {
        final Context app = ctx.getApplicationContext();
        new Thread(() -> {
            String line1 = "Can't reach Nimbus", line2 = "Tap to open", appr = "";
            boolean bad = true;
            try {
                String base = Trust.serverUrl(app);
                URL url = new URL(base + "/api/extras/widget");
                HttpURLConnection c = (HttpURLConnection) url.openConnection();
                if (c instanceof HttpsURLConnection) {
                    ((HttpsURLConnection) c).setSSLSocketFactory(Trust.socketFactory(app, url.getHost()));
                    ((HttpsURLConnection) c).setHostnameVerifier(Trust.PINNED_HOST);
                }
                c.setConnectTimeout(6000); c.setReadTimeout(8000);
                String cookie = CookieManager.getInstance().getCookie(base);
                if (cookie != null) c.setRequestProperty("Cookie", cookie);
                if (c.getResponseCode() == 200) {
                    InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] b = new byte[4096]; int n;
                    while ((n = in.read(b)) > 0) out.write(b, 0, n);
                    JSONObject j = new JSONObject(out.toString("UTF-8"));
                    int up = j.optInt("up"), total = j.optInt("total"), a = j.optInt("approvals"), w = j.optInt("working");
                    JSONArray down = j.optJSONArray("down");
                    bad = down != null && down.length() > 0;
                    line1 = total == 0 ? "Nothing watched" : bad ? (down.length() + " down: " + down.optString(0)) : up + "/" + total + " up · all good";
                    line2 = w == 0 ? "All bots idle" : w + (w == 1 ? " bot working" : " bots working");
                    appr = a == 0 ? "" : a + (a == 1 ? " approval" : " approvals");
                } else if (c.getResponseCode() == 401) { line1 = "Open Nimbus to sign in"; line2 = ""; }
            } catch (Exception e) { /* keep the offline text */ }
            AppWidgetManager mgr = AppWidgetManager.getInstance(app);
            int[] ids = mgr.getAppWidgetIds(new ComponentName(app, StatusWidget.class));
            for (int id : ids) {
                RemoteViews v = new RemoteViews(app.getPackageName(), R.layout.widget_status);
                v.setTextViewText(R.id.w_line1, line1);
                v.setTextViewText(R.id.w_line2, line2);
                v.setTextViewText(R.id.w_appr, appr);
                v.setTextColor(R.id.w_line1, bad ? 0xFFF87171 : 0xFF86EFAC);
                Intent open = new Intent(app, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                v.setOnClickPendingIntent(R.id.w_root, PendingIntent.getActivity(app, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
                Intent r = new Intent(app, StatusWidget.class).setAction(REFRESH);
                v.setOnClickPendingIntent(R.id.w_refresh, PendingIntent.getBroadcast(app, 1, r, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
                mgr.updateAppWidget(id, v);
            }
        }).start();
    }
}
