package ch.brickinventoryapp.sicherheit

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.netz.util.Protokoll

/**
 * Verschlüsselung für das Bearer-Token; die Umsetzung über den Keystore steht in
 * TokenTresor.kt. Hier, ohne Android-Klassen, damit die Regeln dazu auf der JVM laufen.
 */
interface TokenVerschluesselung {
    /** Klartext → speicherbare Zeichenkette. Wirft, wenn die Plattform nicht kann. */
    fun verschluessle(klartext: String): String

    /** Gespeicherte Zeichenkette → Klartext, oder null wenn sie nicht lesbar ist. */
    fun entschluessle(gespeichert: String): String?

    /** Wie [entschluessle], trennt aber „weg“ von „gerade nicht“. Attrappen kennen nur „weg“. */
    fun oeffne(gespeichert: String): Tresorbefund =
        entschluessle(gespeichert)?.let { Tresorbefund.Lesbar(it) } ?: Tresorbefund.Weg

    /** Den Schlüssel selbst löschen: Was er umhüllt hat, ist danach nirgends mehr lesbar. */
    fun vergiss() = Unit

    /** Liegt [gespeichert] unter einem schwächeren Schlüssel, als ihn [verschluessle] jetzt nähme? */
    fun veraltet(gespeichert: String): Boolean = false
}

/** Ist das Gerät gerade gesperrt? Im Gerät der KeyguardManager, im Test ein Wert. */
fun interface Geraetesperre {
    fun gesperrt(): Boolean
}

/**
 * Das Token unter einem Schlüssel, der nur bei entsperrtem Gerät arbeitet ([nurEntsperrt]):
 * Wer ein gesperrtes Gerät ausliest, bekommt den Geheimtext, aber keinen Klartext. Kann er
 * nicht verschlüsseln, wirft er; ein schwächerer Ausweg wäre genau das, was ein gesperrtes
 * Gerät preisgibt. [altbestand] liest nur noch, was frühere Fassungen ohne Bedingung
 * ablegten, bis das nächste Entsperren es umschlüsselt (TokenAblage.stufeTokenHoch).
 */
class EntsperrTresor(
    private val nurEntsperrt: TokenVerschluesselung,
    private val altbestand: TokenVerschluesselung,
) : TokenVerschluesselung {
    override fun verschluessle(klartext: String): String = ENTSPERRT_PRAEFIX + nurEntsperrt.verschluessle(klartext)

    override fun entschluessle(gespeichert: String): String? = (oeffne(gespeichert) as? Tresorbefund.Lesbar)?.klartext

    override fun oeffne(gespeichert: String): Tresorbefund =
        if (gespeichert.startsWith(ENTSPERRT_PRAEFIX)) nurEntsperrt.oeffne(gespeichert.removePrefix(ENTSPERRT_PRAEFIX))
        else altbestand.oeffne(gespeichert)

    override fun veraltet(gespeichert: String): Boolean = !gespeichert.startsWith(ENTSPERRT_PRAEFIX)

    override fun vergiss() {
        nurEntsperrt.vergiss()
        altbestand.vergiss()
    }
}

/** Base64 kennt keinen Doppelpunkt: Geheimtexte ohne dieses Präfix stammen vom Schlüssel ohne Bedingung (Altbestand). */
internal const val ENTSPERRT_PRAEFIX = "e1:"

/** Was beim Öffnen des Tokens herauskam. */
sealed interface Tresorbefund {
    data class Lesbar(val klartext: String) : Tresorbefund

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
internal fun tresorFehlerDauerhaft(e: Throwable): Boolean = when (e) {
    is javax.crypto.BadPaddingException -> true
    is android.security.keystore.KeyPermanentlyInvalidatedException -> true
    is java.security.UnrecoverableKeyException -> true
    is IllegalArgumentException -> true
    else -> false
}

/** Ein Versuch und bei einem vorübergehenden Fehler genau ein zweiter. */
internal fun oeffneMitNeuversuch(versuch: () -> String?): Tresorbefund {
    repeat(2) {
        fangeAusserAbbruch { versuch() }
            .onSuccess { return it?.let { Tresorbefund.Lesbar(it) } ?: Tresorbefund.Weg }
            .onFailure { if (tresorFehlerDauerhaft(it)) return Tresorbefund.Weg }
    }
    return Tresorbefund.Gesperrt
}

/** Pausen beim Start: zusammen unter der Wartezeit des Wächters (TokenAblage.warteAufStart). */
internal val TRESOR_ANLAUF_MS = listOf(250L, 750L, 2_000L)

/** Danach im Hintergrund weiter, höchstens zehn Minuten; der nächste Start versucht es neu. */
internal const val TRESOR_NACHLAUF_MS = 30_000L
internal const val TRESOR_NACHLAUF_VERSUCHE = 20

/**
 * Das Token aus der Ablage für [melde]. Ein gesperrter Keystore meldet nach dem
 * Anlauf einmal „kein Token“ — die Anmeldemaske statt eines hängenden Starts —,
 * löscht aber nichts und meldet das Token nach, sobald es sich öffnen lässt.
 * [alt]: der Klartext aus einer Fassung vor der Verschlüsselung.
 */
suspend fun liesToken(
    tresor: TokenVerschluesselung,
    geheim: String?,
    alt: String?,
    melde: suspend (String) -> Unit,
    warte: suspend (Long) -> Unit = { kotlinx.coroutines.delay(it) },
    sperre: Geraetesperre = Geraetesperre { false },
) {
    if (geheim == null) return melde(alt ?: "")
    liesGeduldig({ tresor.oeffne(geheim) }, alt, melde, warte, sperre)
}

/**
 * Wie [liesToken] für jeden Wert unter einem Schlüssel, der nur entsperrt arbeitet (auch
 * Adresse und Name der TokenAblage): [oeffne] je Versuch, [alt] bei „weg“.
 */
suspend fun liesGeduldig(
    oeffne: () -> Tresorbefund,
    alt: String?,
    melde: suspend (String) -> Unit,
    warte: suspend (Long) -> Unit = { kotlinx.coroutines.delay(it) },
    sperre: Geraetesperre = Geraetesperre { false },
) {
    var versuch = 0
    var leerGemeldet = false
    while (true) {
        when (val b = oeffne()) {
            is Tresorbefund.Lesbar -> return melde(b.klartext)
            Tresorbefund.Weg -> return melde(alt ?: "")
            Tresorbefund.Gesperrt -> {
                if (versuch >= TRESOR_ANLAUF_MS.size && !leerGemeldet) {
                    Protokoll.warnung("Tresor", "Keystore gesperrt; Token bleibt, neuer Versuch im Hintergrund")
                    melde(alt ?: "")
                    leerGemeldet = true
                }
                if (versuch >= TRESOR_ANLAUF_MS.size + TRESOR_NACHLAUF_VERSUCHE) return
                warte(TRESOR_ANLAUF_MS.getOrElse(versuch) { TRESOR_NACHLAUF_MS })
                // Bei gesperrtem Gerät gibt der Schlüssel erst nach dem Entsperren frei:
                // Diese Zeit zählt nicht, sonst wäre nach einer Nacht die Sitzung weg.
                if (versuch < TRESOR_ANLAUF_MS.size || !sperre.gesperrt()) versuch++
            }
        }
    }
}
