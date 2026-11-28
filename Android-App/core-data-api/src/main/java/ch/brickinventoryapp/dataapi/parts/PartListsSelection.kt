package ch.brickinventoryapp.dataapi.parts

import android.content.Context
import android.content.Intent
import android.net.Uri

/** The name under which the target app sees the parts list. */
const val PART_LIST_NAME = "teileliste.pdf"

/** The address of the parts list at the [PartListsProvider]; the authority stands like this in the manifest. */
private fun partListsUri(ctx: Context): Uri =
    Uri.Builder().scheme("content").authority("${ctx.packageName}.teileliste").path(PART_LIST_NAME).build()

/**
 * Open the parts list, always via the system's chooser: it carries the whole
 * inventory, and an app that registered itself as default for PDFs would otherwise get
 * it unnoticed including read permission.
 */
fun partListsSelection(ctx: Context, title: String): Intent {
    val view = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(partListsUri(ctx), "application/pdf")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    return Intent.createChooser(view, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}
