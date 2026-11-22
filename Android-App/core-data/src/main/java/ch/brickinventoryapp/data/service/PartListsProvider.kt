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
import ch.brickinventoryapp.data.util.PartListVault
import ch.brickinventoryapp.data.util.readFromStorage
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import java.io.FileNotFoundException

/** The name under which the target app sees the parts list. */
internal const val PART_LIST_NAME = "teileliste.pdf"

/** The address of the parts list at the [PartListsProvider]; the authority stands like this in the manifest. */
internal fun partListsUri(ctx: Context): Uri =
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

/**
 * Passes on the encrypted parts list without plaintext on disk:
 * a proxy descriptor reads from memory, the target app may seek in it.
 * Not exported; only whoever the chooser grants the right for this Uri may read.
 */
class PartListsProvider : ContentProvider() {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface Access {
        fun partListVault(): PartListVault
    }

    private val reader by lazy { Handler(HandlerThread("teileliste").apply { start() }.looper) }

    override fun onCreate(): Boolean = true

    private fun plaintext(uri: Uri): ByteArray {
        val ctx = context ?: throw FileNotFoundException("Kein Kontext")
        if (uri.path != "/$PART_LIST_NAME") throw FileNotFoundException("Unbekannt: $uri")
        return EntryPointAccessors.fromApplication(ctx, Access::class.java).partListVault().read(ctx.filesDir)
            ?: throw FileNotFoundException("Keine Teileliste")
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw FileNotFoundException("Nur lesen")
        val ctx = context ?: throw FileNotFoundException("Kein Kontext")
        val memory = ctx.getSystemService(Context.STORAGE_SERVICE) as StorageManager
        return memory.openProxyFileDescriptor(ParcelFileDescriptor.MODE_READ_ONLY, StorageFile(plaintext(uri)), reader)
    }

    override fun query(
        uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?,
    ): Cursor {
        val size = plaintext(uri).size.toLong()
        val columns = projection?.toList() ?: listOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        val values = columns.map {
            when (it) {
                OpenableColumns.DISPLAY_NAME -> PART_LIST_NAME
                OpenableColumns.SIZE -> size
                else -> null
            }
        }
        return MatrixCursor(columns.toTypedArray(), 1).apply { addRow(values) }
    }

    override fun getType(uri: Uri): String? = if (uri.path == "/$PART_LIST_NAME") "application/pdf" else null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}

/** A plaintext in memory as a file; overwritten on closing. */
private class StorageFile(private val content: ByteArray) : ProxyFileDescriptorCallback() {
    override fun onGetSize(): Long = content.size.toLong()

    override fun onRead(offset: Long, size: Int, data: ByteArray): Int = readFromStorage(content, offset, size, data)

    override fun onRelease() = content.fill(0)
}
