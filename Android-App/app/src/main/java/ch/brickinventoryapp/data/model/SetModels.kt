package ch.brickinventoryapp.data.model

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Sets: Bestand, Details, Anlegen und Ändern. Die Modelle liegen je Sachgebiet in
 * einer Datei, alle im Paket data.model — Aufrufer binden an das Paket, nicht an
 * die Datei.
 */

@Serializable
data class CsvImportStatus(
    val success: Boolean = false,
    val status: String? = null,   // "running", "done", "cancelled"
    val total: Int? = null,
    val done: Int? = null,
    val current: String? = null,
    val ok: Int? = null,
    val warn: Int? = null,
    val err: Int? = null,
    val error: String? = null     // set when success=false
)

@Serializable
data class SetItem(
    @SerialName("set_number") val setNumber: String,
    val name: String? = null,
    val year: Int? = null,
    val theme: String? = null,
    val pieces: Int? = null,
    val minifigs: Int? = null,
    val quantity: Int = 1,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("added_at") val addedAt: String? = null,
    // Kein `purchase_price`: Der Server führt den Kaufpreis nur in den Erfassungen und
    // liefert ihn hier als `avg_purchase_price` und `max_purchase_price`. Ein immer
    // leeres Feld als Rückfall ergäbe eine stille Null.
    val condition: String? = null, // "N" = New/Neu, "U" = Used/Gebraucht
    /**
     * Lagerort. Im Haushalt können es mehrere sein (zwei Kinder, zwei Kisten); der
     * Server fasst sie zu einem Text zusammen — die Oberfläche zeigt ihn, sie rechnet
     * nicht damit.
     */
    val storage: String? = null,
    /**
     * Alle erfassten Zustände, je einer eine Plakette auf der Kachel. `condition` ist
     * ein Aggregat mit genau einem Wert und verschwiege die Neu-Erfassung neben einer
     * gebrauchten. Der Server entscheidet (conditionsFromAcquisitions), hier wird
     * nichts nachgerechnet.
     */
    val conditions: List<String> = emptyList(),
    /**
     * Besitzer im Haushalt — nur bei mehreren Konten im Blickfeld. Im Einzelkonto wäre
     * es Rauschen; im Haushalt verschiebt man ohne sie das falsche Exemplar.
     */
    val owners: List<HouseholdMember> = emptyList(),
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    /** Mengengewichteter Kaufpreis über die Erfassungen (Server rechnet ihn). */
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("used_count") val usedCount: Int? = null,
    val instructions: List<Instruction> = emptyList(),
    /**
     * BrickLink-Verweis, fertig vom Server (utils/bricklinkLink.ts): Gear, Bücher und
     * Sammelminifiguren liegen unter anderen Parametern oder Nummern; eine aus der
     * Setnummer gebaute Adresse wäre dort still falsch.
     */
    val bricklink: BrickLinkRef? = null,
    /**
     * Preisvergleich, fertig vom Server (utils/preisvergleich.ts) — eine Stelle für
     * die Adresse statt einer je Bildschirm. Leer heisst: kein Knopf statt eines
     * Knopfs ins Leere.
     */
    @SerialName("preisvergleich_url") val preisvergleichUrl: String? = null
) {
    /**
     * Der angezeigte Kaufpreis, mengengewichtet. Die eine Stelle, an der Kachel und
     * Detail ihn holen, damit beide denselben Wert zeigen und er zur Prozentangabe
     * daneben passt.
     */
    val anzeigeKaufpreis: Double?
        get() = avgPurchasePrice
}

@Serializable
data class Instruction(
    val id: Int? = null,
    val url: String,
    val description: String? = null,
    @SerialName("local_path") val localPath: String? = null,
    /**
     * Selbst hochgeladen (true) oder importiert (false)? Nur Hochgeladenes lässt sich
     * löschen, und die `id` allein verrät die Herkunft nicht — beide Tabellen zählen
     * unabhängig. Die Vorgabe false lässt bei einem älteren Server den Papierkorb weg,
     * statt die falsche Zeile zu treffen.
     */
    @SerialName("is_manual") val isManual: Boolean = false
)

@Serializable
data class SetDetailResponse(val success: Boolean, val set: SetItem? = null)

/**
 * Der Name eines Sets aus dem gemeinsamen Katalog, auch wenn es niemandem gehört.
 * /api/v1/sets/{nr} sucht im Blickfeld und antwortet sonst 404 — in der Teileliste
 * trägt man aber gerade fremde Sets ein. Der Server antwortet immer, notfalls mit
 * der Nummer als Name.
 */
@Serializable
data class SetInfoResponse(
    val success: Boolean = false,
    val name: String? = null,
)

@Serializable
data class SetResponse(
    val success: Boolean,
    val set: SetItem? = null,
    val error: String? = null
)

@Serializable
data class SetsResponse(
    val success: Boolean,
    val count: Int = 0,
    val sets: List<SetItem> = emptyList(),
    /** Gesamtzahl über ALLE Seiten — nur bei seitenweisem Abruf gesetzt. */
    val total: Int = 0,
    /**
     * Themen des ganzen Bestands, nicht der geladenen Seite. Der Server
     * schickt sie nur mit der ERSTEN Seite; Folgeseiten sparen die Abfrage.
     */
    val themes: List<String> = emptyList(),
    val error: String? = null
)

@Serializable
data class AddSetRequest(
    @SerialName("set_number") val setNumber: String,
    val quantity: Int = 1,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    val condition: String? = null, // "N" = New/Neu, "U" = Used/Gebraucht
    /**
     * Zielkonto im Haushalt — null = eigenes Konto (Verhalten wie bisher).
     * Ob es erlaubt ist, prüft der Server (canWriteFor), nicht die App.
     */
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    /**
     * Lagerort beim Erfassen; null heisst „nicht erfasst“. Der Server schreibt ihn
     * über dieselbe Stelle wie der Detaildialog (utils/lagerort.ts), ein neuer Ort
     * landet damit auch im Vorrat.
     */
    val storage: String? = null,
)

@Serializable
data class AddSetResponse(
    /**
     * Vorgabe `true`, weil ein fehlendes Feld keine Aussage ist: Gelesen wird es nur,
     * wenn eine Antwort ankam; ein Fehlschlag kommt als `step:'error'` oder als
     * HTTP-Fehler. Ältere Server schickten im `done`-Ereignis kein `success` — das Set
     * war angelegt, die App meldete das Gegenteil.
     */
    val success: Boolean = true,
    val action: String? = null,
    @SerialName("set_number") val setNumber: String? = null,
    val name: String? = null,
    /** Weder Rebrickable noch Brickset haben geantwortet: gespeichert, Name und Bild fehlen noch. */
    @SerialName("katalog_offen") val katalogOffen: Boolean = false,
    val error: String? = null
)

@Serializable
data class UpdateManualItemRequest(
    val quantity: Int,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    val condition: String? = null // "N" = New/Neu, "U" = Used/Gebraucht
)

@Serializable
// encodeDefaults=true schickte bei einer reinen Mengenänderung auch "condition":
// null und "purchase_price": null mit; der Server setzte daraufhin den Zustand
// zurück und überschrieb die Erfassung. EncodeDefault(NEVER) schickt beide nur,
// wenn sie gesetzt sind.
@OptIn(ExperimentalSerializationApi::class)
data class UpdateQuantityRequest(
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val quantity: Int? = null,
    /**
     * Schritt statt Zielzahl: Zwei Geräte, die gleichzeitig „+1“ drücken,
     * ergeben +2. Mit der absoluten Zahl rechneten beide vom selben Stand aus.
     */
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    @SerialName("quantity_delta") val quantityDelta: Int? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val condition: String? = null // "N" = New/Neu, "U" = Used/Gebraucht
)

/**
 * Kennzahlen des Minifiguren-Reiters, vom Server gezählt: Die geladene Liste ist
 * gefiltert (ohne manuelle Figuren) und zählte „manuell erfasst“ immer als 0.
 */
/**
 * „Gibt es dieses Set schon?“ (GET /api/v1/sets/exists/:nummer) — der Server sagt
 * es ausdrücklich, mit derselben Regel wie beim Erfassen, statt dass die App es
 * aus einem Fehler errät und „nicht vorhanden“ mit „nicht erreichbar“ verwechselt.
 */
@Serializable
data class SetExistsResponse(
    val success: Boolean = false,
    val exists: Boolean = false,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("is_self") val isSelf: Boolean = false
)

@Serializable
data class BarcodeResponse(
    val success: Boolean,
    @SerialName("set_number") val setNumber: String = "",
    val name: String? = null,
    val year: Int? = null,
    val pieces: Int? = null,
    val theme: String? = null,
    val minifigs: Int? = null,
    @SerialName("image_url")   val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    val source: String? = null,
    /**
     * Die Setnummer ist geraten, nicht abgeglichen (utils/barcodeQuelle.ts) — der
     * Dialog bittet dann hinzusehen. Vorgabe false: Bei einem älteren Server fehlt nur
     * der Hinweis.
     */
    val unsicher: Boolean = false,
    val error: String? = null
)

@Serializable
data class GenericResponse(
    val success: Boolean,
    val error: String? = null,
    /**
     * Neu berechnetes Zustands-Aggregat nach einem Schreibvorgang auf den Erfassungen,
     * damit die App die Regel „eine U-Erfassung macht das Set gebraucht“ nicht
     * nachbaut und die Kachel sofort stimmt.
     */
    val set: SetAggregate? = null,
    /**
     * Was beim Verschieben eines Kaufpreises ins andere Konto mitgewandert ist
     * (moveSetBetweenAccounts) — für die Erfolgsmeldung. Null: Die Antwort kam nicht
     * vom Verschieben.
     */
    val parts: Int? = null,
    val minifigs: Int? = null,
    @SerialName("source_emptied") val sourceEmptied: Boolean = false,
    /**
     * Die Gesamtmenge des Blickfelds nach einer Mengenänderung. Beim Verringern
     * deckelt der Server bei den eigenen Exemplaren; der Regler übernimmt deshalb
     * diese Zahl statt seiner eigenen. Null: keine Mengenänderung.
     */
    val quantity: Int? = null,
)

@Serializable
data class SetAggregate(
    @SerialName("set_number") val setNumber: String = "",
    val condition: String? = null,
    @SerialName("acq_count") val acqCount: Int? = null,
    @SerialName("used_count") val usedCount: Int? = null,
    // Ohne diese beiden Felder verlöre die Kachel nach dem Speichern die
    // zweite Plakette und den gewichteten Kaufpreis bis zum nächsten
    // vollständigen Laden — genau der Grund, aus dem es das Aggregat gibt.
    val conditions: List<String> = emptyList(),
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null
)

@Serializable
data class DeleteWithQuantityResponse(
    val success: Boolean,
    @SerialName("new_quantity") val newQuantity: Int = 0
)

/**
 * Ergebnis eines CSV-Imports — eine Hülle für alle Adressen, weil sie dieselben
 * Felder schicken (bei Sets heisst „hinzugefügt“ `imported`). Alle Zähler haben
 * Vorgaben: Ein fehlendes Feld ist eine Null, kein Fehler.
 */
@Serializable
data class CsvImportErgebnis(
    val success: Boolean,
    val total: Int = 0,
    val added: Int = 0,
    /** Die Set-Adresse nennt dasselbe `imported`. Siehe [neuAngelegt]. */
    val imported: Int = 0,
    val updated: Int = 0,
    val errors: Int = 0,
    val error: String? = null,
) {
    /** Wie viele Zeilen NEU angelegt wurden, egal welche Adresse geantwortet hat. */
    val neuAngelegt: Int get() = if (added > 0) added else imported
}

/**
 * Welche Art CSV importiert wird: dieselbe Bedienung für alle, die die Webapp
 * anbietet, deshalb ein Aufzählungstyp statt eines Aufrufwegs je Art.
 */
enum class CsvArt { SETS, TEILE, MINIFIGUREN, MERKLISTE, PREISALARME }

// ═══════════════════════════════════════════════════════════════════════════
// Preisalarm — sag Bescheid, wenn ein Set eine Schwelle reisst
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ein Alarm gehört genau einem Konto und kennt kein Blickfeld: Wer eine Schwelle
 * setzt, will selbst benachrichtigt werden.
 */
@Serializable
data class Preisalarm(
    @SerialName("set_number") val setNumber: String = "",
    /** "N" = neu, "U" = gebraucht. Neu und gebraucht liegen oft um ein Vielfaches auseinander. */
    val condition: String = "N",
    /** "unter" oder "ueber". */
    val richtung: String = "unter",
    val schwelle: Double = 0.0,
    @SerialName("currency_code") val currencyCode: String = "",
    /**
     * Schon gemeldet? Der Alarm meldet den Übergang, nicht den Zustand; erst wenn der
     * Preis zurückkehrt, wird der Merker gelöscht.
     */
    val ausgeloest: Boolean = false,
    @SerialName("zuletzt_am") val zuletztAm: String? = null,
    @SerialName("zuletzt_preis") val zuletztPreis: Double? = null,
    /**
     * Der Setname — nur aus der Übersicht (GET /v1/alerts); die Einzelroute braucht
     * ihn nicht, dort steht er über dem Dialog. Ein Modell für beide statt zweier, die
     * auseinanderlaufen; null wird in beiden Fällen gleich behandelt.
     */
    val name: String? = null,
    /**
     * Bildquellen der Übersicht in der Reihenfolge der Finanzen: heruntergeladene
     * Kopie, eigene Sammlung, Katalog. Beim Preisalarm ist der letzte häufig — man
     * beobachtet, was man noch nicht hat. Nur aus der Übersicht.
     */
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("set_img_url") val setImgUrl: String? = null,
    /**
     * Gibt es zu diesem Set eine Detailansicht (also ist die Zeile anklickbar)? Ein
     * Alarm überlebt das Entfernen des Sets. Vorgabe true: Ein älterer Server schickt
     * das Feld nicht, und ein Klick, der in einer Meldung endet, ist besser als eine
     * tote Liste.
     */
    val besitzt: Boolean = true,
)

@Serializable
data class PreisalarmRequest(
    val richtung: String,
    val schwelle: Double,
    val condition: String = "N",
)

@Serializable
data class PreisalarmeResponse(
    val success: Boolean = false,
    val alerts: List<Preisalarm> = emptyList(),
    val error: String? = null,
)

@Serializable
data class PreisalarmResponse(
    val success: Boolean = false,
    val alert: Preisalarm? = null,
    val removed: Int = 0,
    val error: String? = null,
)

/**
 * „Was hat seit <marke> ausgelöst?“ `now` ist die Zeit des Servers und wird zur
 * nächsten Marke (siehe Alarmabholung). Nullable, damit ein älterer Server ohne
 * das Feld als nicht verwertbar gilt, statt still eine leere Marke zu setzen.
 */
@Serializable
data class PendingAlertsResponse(
    val success: Boolean = false,
    val alerts: List<Preisalarm> = emptyList(),
    val now: String? = null,
    val error: String? = null,
)

/**
 * Ein Eintrag der Merkliste. Die Stammdaten kommen aus dem Katalog und sind nicht
 * mitgespeichert (Migration 0021); ein unbekanntes Set hat `name == null` und
 * zeigt seine Nummer.
 */
@Serializable
data class Merkposten(
    @SerialName("set_number") val setNumber: String = "",
    val condition: String = "N",
    @SerialName("created_at") val createdAt: String? = null,
    /** Wem der Merkposten gehoert — im Kontenbaum sieht man fremde mit. */
    @SerialName("user_id") val userId: Int = 0,
    val name: String? = null,
    val year: Int? = null,
    @SerialName("num_parts") val numParts: Int? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    /**
     * Die lokal abgelegte Bilddatei hat Vorrang — dieselbe Regel wie bei Sets, Teilen
     * und Minifiguren: Was auf der Platte des Servers liegt, kommt von dort statt über
     * den Bild-Proxy.
     */
    @SerialName("image_local") val imageLocal: String? = null,
    /** Liegt das Set schon in der Galerie eines Kontos im Blickfeld? */
    /**
     * Marktpreis im Zustand dieses Merkpostens, null solange keiner bekannt ist. Aus
     * dem Preis-Cache des Servers (jobs/priceJob.ts), kein Abruf je Zeile.
     */
    val marktpreis: Double? = null,
    /** Die Waehrung, in der [marktpreis] steht. */
    val waehrung: String = "EUR",
    val owned: Boolean = false,
    /**
     * Der Preisalarm zu genau diesem Merkposten oder null. Er reist mit, damit ein
     * gesetzter Alarm sichtbar bleibt, ohne einen Abruf je Zeile.
     */
    val alarm: MerkpostenAlarm? = null,
    /**
     * Preisvergleich für den Knopf im Detail. Mit dem Merkposten statt aus
     * /catalog/sets/:nr: Ein Set, das der Katalog nicht kennt, ergäbe dort 404 und
     * keinen Knopf (utils/merkliste.ts).
     */
    @SerialName("preisvergleich_url") val preisvergleichUrl: String? = null,
)

@Serializable
data class MerkpostenAlarm(
    val richtung: String = "unter",
    val schwelle: Double = 0.0,
    val ausgeloest: Boolean = false,
)

@Serializable
data class MerklisteResponse(
    val success: Boolean = false,
    val merkposten: List<Merkposten> = emptyList(),
    val error: String? = null,
)

/**
 * Den Inhaber eines Merkpostens wechseln. Beide Konten im Rumpf: Der Betrachter
 * ist nicht zwingend der bisherige Inhaber.
 */
@Serializable
data class MerkpostenInhaberRequest(
    @SerialName("owner_user_id") val ownerUserId: Int,
    @SerialName("neuer_inhaber") val neuerInhaber: Int,
)

/**
 * `zusammengefuehrt`: Das Zielkonto hatte den Merkposten schon, die Quelle ist
 * verschwunden statt umgezogen — sonst meldete die Oberfläche „verschoben“, wo
 * etwas weg ist.
 */
@Serializable
data class MerkpostenInhaberAntwort(
    val success: Boolean = false,
    val verschoben: Boolean = false,
    val zusammengefuehrt: Boolean = false,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    val error: String? = null,
)

@Serializable
data class MerkpostenRequest(
    @SerialName("set_number") val setNumber: String,
    val condition: String = "N",
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
)

/** `war_neu` unterscheidet „hinzugefügt“ von „stand schon drauf“. */
@Serializable
data class MerkpostenAntwort(
    val success: Boolean = false,
    @SerialName("war_neu") val warNeu: Boolean = false,
    val merkposten: Merkposten? = null,
    val error: String? = null,
)

/**
 * `action` ist 'added' oder 'exists' — dasselbe Vokabular wie beim Erfassen, weil
 * der Server dieselbe Funktion ruft (addSet).
 */
@Serializable
data class MerkpostenUebernahmeResponse(
    val success: Boolean = false,
    val action: String? = null,
    @SerialName("set_number") val setNumber: String? = null,
    val error: String? = null,
)

/**
 * Was bei der Übernahme in die Galerie mitgeht; der Server reicht es an addSet()
 * weiter. Ohne Kaufpreis setzt er den Marktpreis ein, wie beim normalen Erfassen.
 */
@Serializable
data class MerkpostenUebernahmeRequest(
    val quantity: Int = 1,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    /**
     * Der Zustand, in dem erfasst wird — nicht der des Merkpostens: Wer gebraucht
     * gesucht und neu gefunden hat, erfasst neu, erledigt ist trotzdem der gebrauchte
     * Merkposten. null = wie der Merkposten.
     */
    val condition: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    /**
     * Lagerort — null heisst „nicht erfasst". Der Server reicht ihn an addSet()
     * weiter, wie Menge und Kaufpreis (utils/merkliste.ts, uebernimm).
     */
    val storage: String? = null,
)

/**
 * Die Marktpreise eines Merkpostens in beiden Zuständen — dieselbe Form wie
 * `current` im Verlauf, damit dieselbe Anzeige sie zeichnet.
 */
@Serializable
data class MerkpostenPreiseResponse(
    val success: Boolean = false,
    val currency: String = "",
    val current: CurrentByCondition = CurrentByCondition(),
    val error: String? = null,
)
