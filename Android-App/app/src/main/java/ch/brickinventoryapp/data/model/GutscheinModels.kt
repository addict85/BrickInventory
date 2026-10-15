package ch.brickinventoryapp.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * LEGO-Geschenkkarten im eigenen Profil.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 *   „Im Eigenen Profil sollen Lego-Gutscheine mit Gutscheinnummer und Pins und
 *    Betrag hinterlegt werden können. […] Bitte die Login jeweils nur 1x im
 *    Backend bauen. Beide Apps sollen die gleichen Services des Backends
 *    verwenden."
 *
 * Deshalb spiegeln diese Modelle EXAKT das, was routes/api_v1/vouchers.ts
 * ausgibt — keine eigene Form, keine Umbenennung. Die Webapp liest dieselbe
 * Antwort; was hier anders hiesse, muesste dort nachgezogen werden.
 *
 * ── Warum der Betrag ein Double ist ─────────────────────────────────────────
 *
 * In der Datenbank steht NUMERIC(12,2), und der pg-Treiber gibt daraus eine
 * ZEICHENKETTE heraus (ein NUMERIC passt nicht zwingend in einen double). Der
 * Server wandelt deshalb schon um — `fuerAussen()` in vouchers.ts macht aus
 * `amount` eine echte Zahl. Hier kommt also eine Zahl an, kein Text.
 *
 * Fuer die ANZEIGE ist Double richtig: Ein Gutschein hat zwei
 * Nachkommastellen, und gerechnet wird mit ihm nicht — er wird gezeigt.
 */
@Serializable
data class Gutschein(
    val id: Int = 0,
    /** Die aufgedruckte Kartennummer. Zeichenkette, weil fuehrende Nullen zaehlen. */
    val number: String = "",
    /** Kann fehlen: Nicht jede Karte traegt einen PIN. */
    val pin: String? = null,
    val amount: Double = 0.0,
    val currency: String = "CHF",
    /**
     * Ob ein PDF hinterlegt ist.
     *
     * Der Server gibt bewusst NICHT den Dateipfad heraus, sondern nur diese
     * Antwort — der Pfad geht den Klienten nichts an, die Frage „gibt es ein
     * PDF" schon. Heruntergeladen wird ueber die id.
     */
    @SerialName("hat_pdf") val hatPdf: Boolean = false,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    /**
     * Wann das Guthaben zuletzt bei LEGO abgefragt wurde, oder null.
     *
     * Getrennt von `updatedAt`, und das ist der ganze Zweck: `updatedAt`
     * aendert sich auch, wenn jemand den Betrag von Hand korrigiert. Erst
     * dieses Feld macht aus „250 CHF" die Auskunft „250 CHF, abgefragt am
     * 15.10." — und ein null unterscheidet „noch nie gefragt" von „gefragt
     * und es waren 250". Die Begruendung steht in Migration 0039.
     */
    @SerialName("guthaben_geprueft_am") val guthabenGeprueftAm: String? = null,
)

/**
 * Die Antwort der Guthaben-Abfrage.
 *
 * `angezeigt` ist der formatierte Text der LEGO-Seite („CHF 250.00") — nur
 * zur Anzeige, nicht gespeichert: Er steht in der Schreibweise des
 * Ausgabelandes, und die App formatiert selbst.
 *
 * `wartenSek` und `grund` kommen bei HTTP 429 mit: Der Server erlaubt
 * hoechstens eine Abfrage je 30 Sekunden ueber ALLE Benutzer (Marcos
 * Vorgabe). Die App wartet damit nicht selbst — sie zeigt den Satz, den der
 * Server schon in der richtigen Sprache mitschickt. Die Felder stehen hier
 * trotzdem, weil `ignoreUnknownKeys` sie sonst stillschweigend wegwirft und
 * die naechste Fassung sie suchen muesste.
 */
@Serializable
data class GuthabenAntwort(
    val success: Boolean = false,
    val voucher: Gutschein? = null,
    val angezeigt: String? = null,
    @SerialName("waehrung_geaendert") val waehrungGeaendert: Boolean = false,
    val grund: String? = null,
    val wartenSek: Int? = null,
    val error: String? = null,
    val code: String? = null,
)

@Serializable
data class GutscheinListe(
    val success: Boolean = true,
    val vouchers: List<Gutschein> = emptyList(),
)

/**
 * Was der Server aus einem hochgeladenen PDF gelesen hat.
 *
 * Alle vier Felder koennen null sein — genau das ist der Zweck: Die App zeigt
 * damit „diese Werte habe ich gelesen" statt den Nutzer raten zu lassen, ob
 * sie stimmen. Bei einem unlesbaren PDF antwortet der Server mit 422 und
 * diesem Objekt, und die Oberflaeche belegt die Felder vor, die da waren.
 */
@Serializable
data class GelesenerGutschein(
    val number: String? = null,
    val pin: String? = null,
    val amount: Double? = null,
    val currency: String? = null,
)

@Serializable
data class GutscheinAntwort(
    val success: Boolean = false,
    val voucher: Gutschein? = null,
    val gelesen: GelesenerGutschein? = null,
    val error: String? = null,
    val code: String? = null,
)

/** Anlegen und Aendern teilen sich den Rumpf — der Server auch (pruefeWerte). */
@Serializable
data class GutscheinRequest(
    val number: String,
    val pin: String? = null,
    val amount: Double,
    val currency: String = "CHF",
)
