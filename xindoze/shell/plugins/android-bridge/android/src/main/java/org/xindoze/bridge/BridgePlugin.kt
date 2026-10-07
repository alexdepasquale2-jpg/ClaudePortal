package org.xindoze.bridge

import android.Manifest
import android.app.Activity
import android.app.ActivityManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.BatteryManager
import android.provider.Settings
import android.webkit.WebView
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class CompleteArgs {
    var prompt: String = ""
    var maxTokens: Int = 64
}

@InvokeArg
class DraftArgs {
    var to: String = ""
    var body: String = ""
}

@InvokeArg
class UrlArgs {
    var url: String = ""
}

@TauriPlugin
class BridgePlugin(private val activity: Activity) : Plugin(activity) {
    override fun load(webView: WebView) {
        activity.runOnUiThread {
            if (canNotify()) {
                startXinod()
            } else if (android.os.Build.VERSION.SDK_INT >= 33) {
                activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4101)
            }
        }
    }

    @Command
    fun status(invoke: Invoke) {
        val ret = JSObject()
        val id = Settings.Secure.getString(activity.contentResolver, Settings.Secure.ANDROID_ID)
        ret.put("installId", id ?: "phone")
        ret.put("ramMb", ramMb())
        ret.put("charging", charging())
        ret.put("edition", activity.getString(R.string.xindoze_edition))
        invoke.resolve(ret)
    }

    @Command
    fun complete(invoke: Invoke) {
        val args = invoke.parseArgs(CompleteArgs::class.java)
        try {
            val model = Llama.ensureModel(activity)
            val text = Llama.complete(model.absolutePath, args.prompt, args.maxTokens)
            val ret = JSObject()
            ret.put("text", text)
            invoke.resolve(ret)
        } catch (err: Throwable) {
            val ret = JSObject()
            ret.put("text", "model: " + (err.message ?: "failed"))
            invoke.resolve(ret)
        }
    }

    @Command
    fun messageDraft(invoke: Invoke) {
        val args = invoke.parseArgs(DraftArgs::class.java)
        val uri = Uri.parse("smsto:" + Uri.encode(args.to))
        val intent = Intent(Intent.ACTION_SENDTO, uri).apply {
            putExtra("sms_body", args.body)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.startActivity(intent)
        invoke.resolve()
    }

    @Command
    fun openUrl(invoke: Invoke) {
        val args = invoke.parseArgs(UrlArgs::class.java)
        val uri = Uri.parse(args.url)
        val scheme = uri.scheme?.lowercase()
        if (scheme != "https" && scheme != "http") {
            invoke.reject("only http(s) links open")
            return
        }
        activity.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        invoke.resolve()
    }

    private fun ramMb(): Long {
        val info = ActivityManager.MemoryInfo()
        val manager = activity.getSystemService(ActivityManager::class.java)
        manager.getMemoryInfo(info)
        return info.totalMem / (1024L * 1024L)
    }

    private fun charging(): Boolean {
        val battery = activity.getSystemService(BatteryManager::class.java)
        return battery.isCharging
    }

    private fun startXinod() {
        try {
            val intent = Intent(activity, XinodService::class.java)
            ContextCompat.startForegroundService(activity, intent)
        } catch (_: Throwable) {
            // A missing notification grant must not stop the Canvas from opening.
        }
    }

    private fun canNotify(): Boolean {
        if (android.os.Build.VERSION.SDK_INT < 33) return true
        return ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
    }
}
