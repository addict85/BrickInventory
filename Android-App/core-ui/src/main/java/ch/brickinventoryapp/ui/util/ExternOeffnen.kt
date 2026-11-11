package ch.brickinventoryapp.ui.util

import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Öffnet eine von `externeAdresse` (core-netz) geprüfte Adresse im Browser; false,
 * wenn keine da ist oder keine App sie nimmt (der Aufrufer sagt es dann). Der Intent
 * gehört zur Oberfläche, die Regel zum Netz. BROWSABLE, damit nur Apps antworten,
 * die sich als Ziel für Weblinks ausweisen; nicht-https bleibt auch hier zu.
 */
fun oeffneExtern(ctx: Context, geprueft: String?): Boolean {
    val ziel = geprueft?.let(Uri::parse)?.takeIf { it.scheme == "https" } ?: return false
    return runCatching {
        ctx.startActivity(Intent(Intent.ACTION_VIEW, ziel).addCategory(Intent.CATEGORY_BROWSABLE))
    }.isSuccess
}
