package ch.brickinventoryapp.data.service

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.os.ParcelFileDescriptor
import android.os.ProxyFileDescriptorCallback
import android.os.storage.StorageManager
import android.provider.OpenableColumns
import ch.brickinventoryapp.data.util.Teilelistentresor
import ch.brickinventoryapp.data.util.readFromStorage
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import java.io.FileNotFoundException

/** The name under which the target app sees the parts list. */
internal const val PART_LIST_NAME = "teileliste.pdf"

/** The address of the parts list at the [TeilelistenProvider]; the authority stands like this in the manifest. */
internal fun partListsUri(ctx: Context): Uri =
    Uri.Builder().scheme("content").authority("${ctx.packageName}.teileliste").path(PART_LIST_NAME).build()

/**
 * Open the parts list, always via the system's chooser: it carries the whole
 * inventory, and an app that registered itself as default for PDFs would otherwise get
 * it unnoticed including read permission.
 */
fun partListsSelection(ctx: Context, titel: String): Intent {
    val ansicht = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(partListsUri(ctx), "application/pdf")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    return Intent.createChooser(ansicht, titel).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}

/**
 * Passes on the encrypted parts list without plaintext on disk:
 * a proxy descriptor reads from memory, the target app may seek in it.
 * Not exported; only whoever the chooser grants the right for this Uri may read.
 */
class TeilelistenProvider : ContentProvider() {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface Zugang {
        fun teilelistentresor(): Teilelistentresor
    }

    private val reader by lazy { Handler(HandlerThread("teileliste").apply { start() }.looper) }

    override fun onCreate(): Boolean = true

    private fun klartext(uri: Uri): ByteArray {
        val ctx = context ?: throw FileNotFoundException("Kein Kontext")
        if (uri.path != "/$PART_LIST_NAME") throw FileNotFoundException("Unbekannt: $uri")
        return EntryPointAccessors.fromApplication(ctx, Zugang::class.java).teilelistentresor().lies(ctx.filesDir)
            ?: throw FileNotFoundException("Keine Teileliste")
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw FileNotFoundException("Nur lesen")
        val ctx = context ?: throw FileNotFoundException("Kein Kontext")
        val speicher = ctx.getSystemService(Context.STORAGE_SERVICE) as StorageManager
        return speicher.openProxyFileDescriptor(ParcelFileDescriptor.MODE_READ_ONLY, StorageFile(klartext(uri)), reader)
    }

    override fun query(
        uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?,
    ): Cursor {
        val groesse = klartext(uri).size.toLong()
        val spalten = projection?.toList() ?: listOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        val werte = spalten.map {
            when (it) {
                OpenableColumns.DISPLAY_NAME -> PART_LIST_NAME
                OpenableColumns.SIZE -> groesse
                else -> null
            }
        }
        return MatrixCursor(spalten.toTypedArray(), 1).apply { addRow(werte) }
    }

    override fun getType(uri: Uri): String? = if (uri.path == "/$PART_LIST_NAME") "application/pdf" else null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}

/** A plaintext in memory as a file; overwritten on closing. */
private class StorageFile(private val inhalt: ByteArray) : ProxyFileDescriptorCallback() {
    override fun onGetSize(): Long = inhalt.size.toLong()

    override fun onRead(offset: Long, size: Int, data: ByteArray): Int = readFromStorage(inhalt, offset, size, data)

    override fun onRelease() = inhalt.fill(0)
}
