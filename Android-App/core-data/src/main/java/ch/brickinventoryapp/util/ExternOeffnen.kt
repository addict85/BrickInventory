package ch.brickinventoryapp.util

import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Öffnet eine Adresse im Browser, wenn [externeAdresse] sie durchlässt; false,
 * wenn nicht oder wenn keine App sie nimmt (der Aufrufer sagt es dann). BROWSABLE,
 * damit nur Apps antworten, die sich als Ziel für Weblinks ausweisen.
 */
fun oeffneExtern(ctx: Context, url: String?): Boolean {
    val ziel = externeAdresse(url) ?: return false
    return runCatching {
        ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(ziel.toString())).addCategory(Intent.CATEGORY_BROWSABLE))
    }.isSuccess
}
