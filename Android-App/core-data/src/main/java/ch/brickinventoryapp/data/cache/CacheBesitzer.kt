package ch.brickinventoryapp.data.cache

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import java.io.File
import java.security.MessageDigest

/**
 * Wem die lokale Ablage gehört: Server und Sitzung. Im Gerät der TokenAblage;
 * die Schnittstelle hält die Ablage ohne DataStore prüfbar.
 */
fun interface CacheBesitzer {
    /** Null, solange kein Server oder kein Token hinterlegt ist. */
    suspend fun cacheBereich(): String?

    /**
     * Server und Konto, ohne den Token: Der wechselt beim Tausch (Rotation), und
     * Room-Ablage samt Ausgang müssen das überleben. Null wie [cacheBereich].
     */
    suspend fun kontoBereich(): String? = cacheBereich()

    /** [kontoBereich] als Fluss, für wer ihn beobachtet; ohne eigenen Spiegel einmal gefragt. */
    fun kontoBereichFluss(): Flow<String?> = flow { emit(kontoBereich()) }
}

/** Name des Bereichs in der Ablage: gestreut, damit weder Adresse noch Token auf der Platte stehen. */
internal fun bereichsName(bereich: String): String =
    MessageDigest.getInstance("SHA-256").digest(bereich.toByteArray()).joinToString("") { "%02x".format(it) }.take(32)

/**
 * Der frühere Antwort-Zwischenspeicher (`api-*`) liegt seit der einen Ablage brach. Er
 * hielt Antworten eines Kontos; was niemand mehr liest, soll nicht liegen bleiben.
 */
internal fun raeumeAlteAntwortablage(vararg ordner: File) {
    for (o in ordner) o.listFiles()?.filter { it.isDirectory && it.name.startsWith("api-") }?.forEach { it.deleteRecursively() }
}
