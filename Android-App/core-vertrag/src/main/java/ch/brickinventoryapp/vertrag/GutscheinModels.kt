package ch.brickinventoryapp.vertrag

import ch.brickinventoryapp.model.fach.Waehrung
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * LEGO-Geschenkkarten im eigenen Profil. Die Modelle spiegeln genau das, was
 * routes/api_v1/vouchers.ts ausgibt — keine eigene Form, keine Umbenennung —, weil
 * beide Apps dieselben Dienste des Backends verwenden; was hier anders hiesse,
 * müsste die Webapp nachziehen.
 */
@Serializable
data class Gutschein(
    val id: Int = 0,
    /**
     * Die Kartennummer, vom Server nur als Maske („…1234“); den Klartext gibt
     * [GutscheinKlartext]. Zeichenkette, weil fuehrende Nullen zaehlen.
     */
    val number: String = "",
    /** [GUTSCHEIN_PIN_MASKE] oder null: Nicht jede Karte traegt einen PIN. */
    val pin: String? = null,
    val amount: Double = 0.0,
    val currency: Waehrung = Waehrung.CHF,
    /**
     * Ob ein PDF hinterlegt ist. Der Server gibt bewusst nicht den Dateipfad heraus —
     * der geht den Klienten nichts an; heruntergeladen wird über die id.
     */
    @SerialName("hat_pdf") val hatPdf: Boolean = false,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    /**
     * Wann das Guthaben zuletzt bei LEGO abgefragt wurde, oder null. Getrennt von
     * `updatedAt`, das sich auch bei einer Korrektur von Hand ändert: Erst dieses Feld
     * macht aus „250 CHF“ die Auskunft „250 CHF, abgefragt am 15.10.“, und null heisst
     * „noch nie gefragt“. Begründung in Migration 0039.
     */
    @SerialName("guthaben_geprueft_am") val guthabenGeprueftAm: String? = null,
)

/**
 * Die Antwort der Guthaben-Abfrage.
 * `wartenSek` und `grund` kommen bei HTTP 429 und stehen hier, weil ignoreUnknownKeys sie sonst
 * still verwürfe.
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
 * Was der Server aus einem hochgeladenen PDF gelesen hat. Alle vier Felder können
 * null sein — die App zeigt so „diese Werte habe ich gelesen“, statt raten zu
 * lassen. Bei einem unlesbaren PDF antwortet der Server mit 422 und diesem Objekt;
 * die Oberfläche belegt vor, was da war.
 */
@Serializable
data class GelesenerGutschein(
    val number: String? = null,
    val pin: String? = null,
    val amount: Double? = null,
    val currency: Waehrung? = null,
)

/**
 * Was beim Hochladen eines Sammel-PDFs herauskam: Mehrere Seiten ergeben mehrere
 * Gutscheine, und dieselbe Route antwortet je nach Datei mit `voucher` oder mit
 * diesem Block. Dieselben Felder wie bei den CSV-Importen (added/updated/errors),
 * damit die Meldung sagt, wie viele es wurden.
 */
@Serializable
data class GutscheinStapel(
    val added: Int = 0,
    val updated: Int = 0,
    val errors: Int = 0,
    val total: Int = 0,
)

@Serializable
data class GutscheinAntwort(
    val success: Boolean = false,
    val voucher: Gutschein? = null,
    /** Gesetzt, wenn das PDF MEHRERE Gutscheine enthielt. */
    val mehrere: GutscheinStapel? = null,
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
    val currency: Waehrung = Waehrung.CHF,
)

/**
 * Nummer und PIN im Klartext (POST /vouchers/{id}/klartext). Nur nach Passwort
 * und gegebenenfalls Code, und nur im ViewModel gehalten: Die Liste trägt die
 * Maske, damit ein erbeutetes Token nicht alle Karten samt PIN hergibt.
 */
@Serializable
data class GutscheinKlartext(
    val success: Boolean = false,
    val id: Int = 0,
    val number: String = "",
    val pin: String? = null,
)

/**
 * Ein einmaliges Ticket für ein Gutschein-PDF (POST …/pdf-freigabe). Der
 * Betrachter hängt es an die Adresse; es gilt [gueltigSek] Sekunden und einen Abruf.
 */
@Serializable
data class GutscheinPdfFreigabe(
    val success: Boolean = false,
    val ticket: String = "",
    @SerialName("gueltig_sek") val gueltigSek: Int = 0,
)
