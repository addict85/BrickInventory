package ch.brickinventoryapp.ui.util

import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Opens an address checked by `externalAddress` (core-network) in the browser; false
 * if there is none or no app takes it (the caller then says so). The intent
 * belongs to the UI, the rule to the network. BROWSABLE, so that only apps answer
 * that identify themselves as targets for web links; non-https also stays closed here.
 */
fun openExtern(ctx: Context, checked: String?): Boolean {
    val target = checked?.let(Uri::parse)?.takeIf { it.scheme == "https" } ?: return false
    return runCatching {
        ctx.startActivity(Intent(Intent.ACTION_VIEW, target).addCategory(Intent.CATEGORY_BROWSABLE))
    }.isSuccess
}
