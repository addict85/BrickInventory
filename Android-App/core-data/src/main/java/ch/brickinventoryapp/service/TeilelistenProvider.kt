package ch.brickinventoryapp.service

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
import ch.brickinventoryapp.util.Teilelistentresor
import ch.brickinventoryapp.util.liesAusSpeicher
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import java.io.FileNotFoundException

/** Der Name, unter dem die Ziel-App die Teileliste sieht. */
internal const val TEILELISTE_NAME = "teileliste.pdf"

/** Die Adresse der Teileliste beim [TeilelistenProvider]; die Authority steht so im Manifest. */
internal fun teilelistenUri(ctx: Context): Uri =
    Uri.Builder().scheme("content").authority("${ctx.packageName}.teileliste").path(TEILELISTE_NAME).build()

/**
 * Die Teileliste öffnen, immer über die Auswahl des Systems: Sie trägt das ganze
 * Inventar, und eine App, die sich als Standard für PDFs eingetragen hat, bekäme
 * sie sonst unbemerkt samt Leserecht.
 */
fun teilelistenAuswahl(ctx: Context, titel: String): Intent {
    val ansicht = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(teilelistenUri(ctx), "application/pdf")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    return Intent.createChooser(ansicht, titel).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}

/**
 * Gibt die verschlüsselt abgelegte Teileliste weiter, ohne Klartext auf der Platte:
 * Ein Proxy-Deskriptor liest aus dem Speicher, die Ziel-App darf darin springen.
 * Nicht exportiert; lesen darf nur, wem die Auswahl das Recht für diese Uri gibt.
 */
class TeilelistenProvider : ContentProvider() {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface Zugang {
        fun teilelistentresor(): Teilelistentresor
    }

    private val leser by lazy { Handler(HandlerThread("teileliste").apply { start() }.looper) }

    override fun onCreate(): Boolean = true

    private fun klartext(uri: Uri): ByteArray {
        val ctx = context ?: throw FileNotFoundException("Kein Kontext")
        if (uri.path != "/$TEILELISTE_NAME") throw FileNotFoundException("Unbekannt: $uri")
        return EntryPointAccessors.fromApplication(ctx, Zugang::class.java).teilelistentresor().lies(ctx.filesDir)
            ?: throw FileNotFoundException("Keine Teileliste")
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw FileNotFoundException("Nur lesen")
        val ctx = context ?: throw FileNotFoundException("Kein Kontext")
        val speicher = ctx.getSystemService(Context.STORAGE_SERVICE) as StorageManager
        return speicher.openProxyFileDescriptor(ParcelFileDescriptor.MODE_READ_ONLY, SpeicherDatei(klartext(uri)), leser)
    }

    override fun query(
        uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?,
    ): Cursor {
        val groesse = klartext(uri).size.toLong()
        val spalten = projection?.toList() ?: listOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        val werte = spalten.map {
            when (it) {
                OpenableColumns.DISPLAY_NAME -> TEILELISTE_NAME
                OpenableColumns.SIZE -> groesse
                else -> null
            }
        }
        return MatrixCursor(spalten.toTypedArray(), 1).apply { addRow(werte) }
    }

    override fun getType(uri: Uri): String? = if (uri.path == "/$TEILELISTE_NAME") "application/pdf" else null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}

/** Ein Klartext im Speicher als Datei; beim Schliessen überschrieben. */
private class SpeicherDatei(private val inhalt: ByteArray) : ProxyFileDescriptorCallback() {
    override fun onGetSize(): Long = inhalt.size.toLong()

    override fun onRead(offset: Long, size: Int, data: ByteArray): Int = liesAusSpeicher(inhalt, offset, size, data)

    override fun onRelease() = inhalt.fill(0)
}
