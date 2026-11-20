package ch.brickinventoryapp.security

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.network.util.Protokoll

/**
 * Verschlüsselung für das Bearer-Token; die Umsetzung über den Keystore steht in
 * TokenTresor.kt. Hier, ohne Android-Klassen, damit die Regeln dazu auf der JVM laufen.
 */
interface TokenEncryption {
    /** Klartext → speicherbare Zeichenkette. Wirft, wenn die Plattform nicht kann. */
    fun verschluessle(klartext: String): String

    /** Gespeicherte Zeichenkette → Klartext, oder null wenn sie nicht lesbar ist. */
    fun entschluessle(gespeichert: String): String?

    /** Wie [entschluessle], trennt aber „weg“ von „gerade nicht“. Attrappen kennen nur „weg“. */
    fun oeffne(gespeichert: String): Tresorbefund =
        entschluessle(gespeichert)?.let { Tresorbefund.Readable(it) } ?: Tresorbefund.Weg

    /** Den Schlüssel selbst löschen: Was er umhüllt hat, ist danach nirgends mehr lesbar. */
    fun vergiss() = Unit

    /** Liegt [gespeichert] unter einem schwächeren Schlüssel oder Format, als [verschluessle] es jetzt nähme? */
    fun veraltet(gespeichert: String): Boolean = false

    /** Nach dem Umschlüsseln: Der Schlüssel des Altbestands hat nichts mehr zu öffnen und geht. */
    fun forgetLegacyStock() = Unit
}

/** Ist das Gerät gerade gesperrt? Im Gerät der KeyguardManager, im Test ein Wert. */
fun interface Geraetesperre {
    fun gesperrt(): Boolean
}

/**
 * Das Token unter einem Schlüssel, der nur bei entsperrtem Gerät arbeitet ([onlyUnlocked]):
 * Wer ein gesperrtes Gerät ausliest, bekommt den Geheimtext, aber keinen Klartext. Kann er
 * nicht verschlüsseln, wirft er; ein schwächerer Ausweg wäre genau das, was ein gesperrtes
 * Gerät preisgibt. [altbestand] liest nur noch, was frühere Fassungen ohne Bedingung
 * ablegten, bis das nächste Entsperren es umschlüsselt (TokenAblage.levelTokenHigh).
 */
class EntsperrVault(
    private val onlyUnlocked: TokenEncryption,
    private val altbestand: TokenEncryption,
) : TokenEncryption {
    override fun verschluessle(klartext: String): String = UNLOCKED_PREFIX + onlyUnlocked.verschluessle(klartext)

    override fun entschluessle(gespeichert: String): String? = (oeffne(gespeichert) as? Tresorbefund.Readable)?.klartext

    override fun oeffne(gespeichert: String): Tresorbefund =
        if (gespeichert.startsWith(UNLOCKED_PREFIX)) onlyUnlocked.oeffne(gespeichert.removePrefix(UNLOCKED_PREFIX))
        else altbestand.oeffne(gespeichert)

    override fun veraltet(gespeichert: String): Boolean =
        !gespeichert.startsWith(UNLOCKED_PREFIX) || onlyUnlocked.veraltet(gespeichert.removePrefix(UNLOCKED_PREFIX))

    override fun forgetLegacyStock() = altbestand.vergiss()

    override fun vergiss() {
        onlyUnlocked.vergiss()
        altbestand.vergiss()
    }
}

/** Base64 kennt keinen Doppelpunkt: Geheimtexte ohne dieses Präfix stammen vom Schlüssel ohne Bedingung (Altbestand). */
internal const val UNLOCKED_PREFIX = "e1:"

/** Was beim Öffnen des Tokens herauskam. */
sealed interface Tresorbefund {
    data class Readable(val klartext: String) : Tresorbefund

    /** Schlüssel weg oder Geheimtext unbrauchbar: Dieses Token kommt nicht wieder. */
    data object Weg : Tresorbefund

    /** Der Keystore antwortet gerade nicht (Hochfahren, StrongBox); das Token ist noch da. */
    data object Gesperrt : Tresorbefund
}

/**
 * Nur diese Fehler heissen „Token weg“: falscher Schlüssel oder beschädigter
 * Geheimtext (AEADBadTag ist ein BadPadding), ein ungültig gewordener oder
 * unlesbarer Schlüssel, unlesbares Base64. Alles andere kann beim nächsten
 * Versuch gehen und darf nicht abmelden.
 */
internal fun vaultErrorPermanent(e: Throwable): Boolean = when (e) {
    is javax.crypto.BadPaddingException -> true
    is android.security.keystore.KeyPermanentlyInvalidatedException -> true
    is java.security.UnrecoverableKeyException -> true
    is IllegalArgumentException -> true
    else -> false
}

/** Ein Versuch und bei einem vorübergehenden Fehler genau ein zweiter. */
internal fun openWithRetry(attempt: () -> String?): Tresorbefund {
    repeat(2) {
        fangeAusserAbbruch { attempt() }
            .onSuccess { return it?.let { Tresorbefund.Readable(it) } ?: Tresorbefund.Weg }
            .onFailure { if (vaultErrorPermanent(it)) return Tresorbefund.Weg }
    }
    return Tresorbefund.Gesperrt
}

/** Pausen beim Start: zusammen unter der Wartezeit des Wächters (TokenAblage.waitOnStart). */
internal val VAULT_ATTEMPT_MS = listOf(250L, 750L, 2_000L)

/** Danach im Hintergrund weiter, höchstens zehn Minuten; der nächste Start versucht es neu. */
internal const val VAULT_FOLLOW_UP_MS = 30_000L
internal const val VAULT_FOLLOW_UP_ATTEMPTS = 20

/**
 * Das Token aus der Ablage für [melde]. Ein gesperrter Keystore meldet nach dem
 * Anlauf einmal „kein Token“ — die Anmeldemaske statt eines hängenden Starts —,
 * löscht aber nichts und meldet das Token nach, sobald es sich öffnen lässt.
 * [alt]: der Klartext aus einer Fassung vor der Verschlüsselung.
 */
suspend fun readToken(
    tresor: TokenEncryption,
    geheim: String?,
    alt: String?,
    melde: suspend (String) -> Unit,
    wait: suspend (Long) -> Unit = { kotlinx.coroutines.delay(it) },
    lock: Geraetesperre = Geraetesperre { false },
) {
    if (geheim == null) return melde(alt ?: "")
    readPatient({ tresor.oeffne(geheim) }, alt, melde, wait, lock)
}

/**
 * Wie [readToken] für jeden Wert unter einem Schlüssel, der nur entsperrt arbeitet (auch
 * Adresse und Name der TokenAblage): [oeffne] je Versuch, [alt] bei „weg“.
 */
suspend fun readPatient(
    oeffne: () -> Tresorbefund,
    alt: String?,
    melde: suspend (String) -> Unit,
    wait: suspend (Long) -> Unit = { kotlinx.coroutines.delay(it) },
    lock: Geraetesperre = Geraetesperre { false },
) {
    var attempt = 0
    var emptyReported = false
    while (true) {
        when (val b = oeffne()) {
            is Tresorbefund.Readable -> return melde(b.klartext)
            Tresorbefund.Weg -> return melde(alt ?: "")
            Tresorbefund.Gesperrt -> {
                if (attempt >= VAULT_ATTEMPT_MS.size && !emptyReported) {
                    Protokoll.warnung("Tresor", "Keystore gesperrt; Token bleibt, neuer Versuch im Hintergrund")
                    melde(alt ?: "")
                    emptyReported = true
                }
                if (attempt >= VAULT_ATTEMPT_MS.size + VAULT_FOLLOW_UP_ATTEMPTS) return
                wait(VAULT_ATTEMPT_MS.getOrElse(attempt) { VAULT_FOLLOW_UP_MS })
                // Bei gesperrtem Gerät gibt der Schlüssel erst nach dem Entsperren frei:
                // Diese Zeit zählt nicht, sonst wäre nach einer Nacht die Sitzung weg.
                if (attempt < VAULT_ATTEMPT_MS.size || !lock.gesperrt()) attempt++
            }
        }
    }
}
