package ch.brickinventoryapp.data.cache

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import java.io.File
import java.security.MessageDigest

/**
 * Wem die lokale Ablage gehört: Server und Sitzung. Im Gerät der TokenAblage;
 * die Schnittstelle hält die Ablage ohne DataStore prüfbar.
 */
fun interface CacheOwner {
    /** Null, solange kein Server oder kein Token hinterlegt ist. */
    suspend fun cacheArea(): String?

    /**
     * Server und Konto, ohne den Token: Der wechselt beim Tausch (Rotation), und
     * Room-Ablage samt Ausgang müssen das überleben. Null wie [cacheArea].
     */
    suspend fun accountArea(): String? = cacheArea()

    /** [accountArea] als Fluss, für wer ihn beobachtet; ohne eigenen Spiegel einmal gefragt. */
    fun accountAreaFlow(): Flow<String?> = flow { emit(accountArea()) }
}

/** Name des Bereichs in der Ablage: gestreut, damit weder Adresse noch Token auf der Platte stehen. */
internal fun areaName(bereich: String): String =
    MessageDigest.getInstance("SHA-256").digest(bereich.toByteArray()).joinToString("") { "%02x".format(it) }.take(32)

/**
 * Der frühere Antwort-Zwischenspeicher (`api-*`) liegt seit der einen Ablage brach. Er
 * hielt Antworten eines Kontos; was niemand mehr liest, soll nicht liegen bleiben.
 */
internal fun cleanOldResponseStore(vararg folder: File) {
    for (o in folder) o.listFiles()?.filter { it.isDirectory && it.name.startsWith("api-") }?.forEach { it.deleteRecursively() }
}
