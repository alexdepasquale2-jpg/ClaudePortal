package org.xindoze.bridge

import android.content.Context
import java.io.File

object Llama {
    init {
        System.loadLibrary("xindoze_llama")
    }

    external fun complete(modelPath: String, prompt: String, maxTokens: Int): String

    fun ensureModel(context: Context): File {
        val out = File(context.filesDir, "models/xindoze-tiny.gguf")
        if (out.exists() && out.length() > 0L) return out
        out.parentFile?.mkdirs()
        context.assets.open("models/xindoze-tiny.gguf").use { input ->
            out.outputStream().use { output -> input.copyTo(output) }
        }
        return out
    }
}
