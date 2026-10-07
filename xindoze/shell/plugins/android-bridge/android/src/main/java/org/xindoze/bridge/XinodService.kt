package org.xindoze.bridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class XinodService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Xindoze",
            NotificationManager.IMPORTANCE_LOW
        )
        channel.description = "Xindoze stays running so the phone can answer."
        manager.createNotificationChannel(channel)
        val notification: Notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(TITLE)
            .setContentText(TEXT)
            .setSmallIcon(R.drawable.ic_stat_xindoze)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTE_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTE_ID, notification)
        }
        return START_STICKY
    }

    companion object {
        const val CHANNEL_ID = "xindoze.xinod"
        const val TITLE = "Xindoze"
        const val TEXT = "Xindoze has evolved."
        const val NOTE_ID = 1
    }
}
