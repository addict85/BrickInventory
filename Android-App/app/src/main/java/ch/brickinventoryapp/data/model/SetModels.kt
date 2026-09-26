package ch.brickinventoryapp.data.model

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Sets: Bestand, Details, Anlegen und Aendern.
 *
 * ── Warum diese Datei existiert (Nachtrag 155) ──────────────────────────────
 *
 * Alle 92 Datenklassen der App standen in EINER Datei, Models.kt, mit 1158
 * Zeilen. Jede Aenderung an irgendeinem Modell beruehrte dieselbe Datei — bei
 * parallelen Aenderungen ein sicherer Konflikt, und beim Suchen war der Weg
 * immer derselbe: eine Datei oeffnen und scrollen.
 *
 * Aufgeteilt wurde entlang der Sachgebiete. Die Klassen selbst sind WORTGLEICH
 * uebernommen: Es wurde nichts umbenannt, nichts zusammengefasst und kein Feld
 * angefasst. Sie liegen weiter im Paket ch.brickinventoryapp.data.model, also
 * aendert sich fuer keinen Aufrufer etwas — Kotlin bindet an das Paket, nicht
 * an die Datei.
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
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    val condition: String? = null, // "N" = New/Neu, "U" = Used/Gebraucht
    /**
     * Lagerort — wo liegt dieses Set.
     *
     * Im Haushalt kann es MEHRERE sein („Kiste 3, Regal B"): Besitzen zwei
     * Kinder dasselbe Set, liegt es in zwei Kisten, und der Server fasst die
     * Orte zusammen statt einen davon zu zeigen. Deshalb ein Text und keine
     * Liste — die Oberflaeche zeigt ihn, sie rechnet nicht damit.
     */
    val storage: String? = null,
    /**
     * ALLE erfassten Zustände — je einer bekommt auf der Kachel eine Plakette.
     *
     * `condition` oben ist ein Aggregat und liefert genau einen Wert
     * („gebraucht, sobald eine Erfassung gebraucht ist"). Wer ein Exemplar neu
     * und eines gebraucht gekauft hat, sah damit nur „Gebraucht" — obwohl die
     * Neu-Erfassung mit ihrem eigenen Preis in die Bewertung eingeht.
     *
     * Der Server entscheidet, was drinsteht (conditionsFromAcquisitions in
     * utils/handlers.ts); hier wird nichts nachgerechnet.
     */
    val conditions: List<String> = emptyList(),
    /**
     * Besitzer im Haushalt — nur gesetzt, wenn mehrere Konten im Blickfeld
     * sind. Im Einzelkonto stünde an jeder Kachel „gehört mir", und das ist
     * Rauschen; im Haushalt ist es die wichtigste Angabe der Kachel, denn ohne
     * sie verschiebt man das falsche Exemplar.
     */
    val owners: List<HouseholdMember> = emptyList(),
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    /** Mengengewichteter Kaufpreis über die Erfassungen (Server rechnet ihn). */
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("used_count") val usedCount: Int? = null,
    val instructions: List<Instruction> = emptyList(),
    /**
     * BrickLink-Verweis, FERTIG vom Server aufgeloest (utils/bricklinkLink.ts).
     *
     * Dieselbe Begruendung wie beim Katalog (BrickLinkRef dort): Die Adresse
     * laesst sich NICHT aus der Setnummer herleiten — Gear und Buecher liegen
     * unter einem anderen Parameter, Sammelminifiguren unter einer ganz
     * anderen Nummer. Eine im Klienten gebaute Adresse waere fuer diese Faelle
     * still falsch.
     */
    val bricklink: BrickLinkRef? = null,
    /**
     * Preisvergleich, ebenfalls fertig vom Server (utils/preisvergleich.ts).
     *
     * Nicht hier gebaut, obwohl es „nur eine Suchadresse" ist: Sie stand
     * bisher an genau EINER Stelle im Baum (ComparisonScreen), und vier
     * daraus zu machen waere der Anfang von vier Wahrheiten.
     *
     * Leer heisst „keine Adresse" — dann faellt der Knopf weg, statt ins
     * Leere zu fuehren.
     */
    @SerialName("preisvergleich_url") val preisvergleichUrl: String? = null
) {
    /**
     * Der Kaufpreis, der ANGEZEIGT wird — mengengewichtet (Nachtrag 76).
     *
     * Marcos Befund: „In der Android-App wird der Kaufpreis des gebrauchten
     * Sets angezeigt, in der Webapp der gewichtete Durchschnittspreis."
     *
     * `purchasePrice` ist nur der in die sets-Zeile GESPIEGELTE Wert der
     * neuesten Erfassung. Bei mehreren Käufen (2×7.41 gebraucht, 1×9.48 neu)
     * ist das nicht der Preis der Sammlung, sondern der des letzten Kaufs — und
     * er passt auch nicht zur Prozentangabe daneben, die gegen den
     * Durchschnitt rechnet.
     *
     * Die Webapp nutzt `avg_purchase_price` seit jeher (mit demselben Rückfall).
     * Der Server rechnet den Wert; beide Clients lesen jetzt DASSELBE Feld —
     * die Regel steht hier EINMAL statt in jeder Ansicht.
     */
    val anzeigeKaufpreis: Double?
        get() = avgPurchasePrice ?: purchasePrice
}

@Serializable
data class Instruction(
    val id: Int? = null,
    val url: String,
    val description: String? = null,
    @SerialName("local_path") val localPath: String? = null,
    /**
     * Selbst hochgeladen (true) oder automatisch importiert (false)?
     *
     * Der Server legt zwei Quellen zusammen: `shared_instructions` (die Suche
     * bei Rebrickable, Brickset & Co., fuer alle Konten dieselbe) und
     * `instructions` (was ein Konto selbst hochgeladen hat). Nur die zweite
     * laesst sich wieder loeschen — die Route dafuer sucht ausschliesslich
     * dort. Beide Tabellen haben eine `id`, die Zaehler laufen unabhaengig;
     * am `id != null` allein ist die Herkunft also NICHT zu erkennen.
     *
     * Der Standard `false` ist die vorsichtige Seite: Ein Server, der das Feld
     * noch nicht mitschickt, fuehrt zu einem fehlenden Papierkorb — nicht zu
     * einem, der die falsche Zeile trifft.
     */
    @SerialName("is_manual") val isManual: Boolean = false
)

@Serializable
data class SetDetailResponse(val success: Boolean, val set: SetItem? = null)

/**
 * Der Name eines Sets aus dem GEMEINSAMEN Katalog — unabhaengig davon, ob es
 * jemandem gehoert.
 *
 * Der Unterschied zu [SetDetailResponse] ist genau dieser Punkt:
 * /api/v1/sets/{nr} sucht im Blickfeld des Nutzers und antwortet mit 404, wenn
 * das Set niemandem im Haushalt gehoert. Fuer die temporaere Teileliste ist
 * das der Regelfall — dort traegt man Sets ein, die man NICHT hat, um zu
 * sehen, welche Teile fehlen. Die App zeigte dort bisher nur die Nummer, die
 * Webapp den Namen.
 *
 * Der Server sucht erst im Katalog, dann in den eigenen Sets, und gibt zuletzt
 * die Nummer selbst als Namen zurueck — es gibt also immer eine Antwort.
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
     * Lagerort — null heisst „nicht erfasst".
     *
     * Marcos Befund vom 24.09.: Der Ort liess sich erst NACH dem Erfassen im
     * Detaildialog setzen. Der Server nimmt ihn seit demselben Tag auch beim
     * Erfassen an und schreibt ihn ueber dieselbe Stelle wie der Detaildialog
     * (utils/lagerort.ts) — ein neu getippter Ort landet damit auch im Vorrat.
     */
    val storage: String? = null,
)

@Serializable
data class AddSetResponse(
    val success: Boolean,
    val action: String? = null,
    @SerialName("set_number") val setNumber: String? = null,
    val name: String? = null,
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
// Der globale Json-Serializer nutzt encodeDefaults=true — ohne die
// EncodeDefault(NEVER)-Annotationen würde eine reine Mengenänderung
// zusätzlich "purchase_price": null und "condition": null senden. Auf dem
// Server löste "condition": null eine Coercion auf "N" aus (setzte den
// Zustand zurück) und ein mitgeschickter Kaufpreis überschrieb die soeben
// angelegte Erfassung. Beide Felder werden jetzt nur noch übertragen, wenn
// sie tatsächlich gesetzt sind.
@OptIn(ExperimentalSerializationApi::class)
data class UpdateQuantityRequest(
    val quantity: Int,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val condition: String? = null // "N" = New/Neu, "U" = Used/Gebraucht
)

/**
 * Kennzahlen des Minifiguren-Reiters — vom SERVER gezählt.
 *
 * Vorher rechnete der Schirm sie aus der geladenen Liste. Die ist aber
 * gefiltert (`source != "manual"`), also zählte die Kachel „manuell erfasst"
 * zwangsläufig immer 0, und Arten/Stückzahl liessen die manuellen Einträge
 * aus — die Webapp zählte sie mit. Zwei Apps, zwei Zahlen für dieselbe
 * Sammlung. Gezählt wird jetzt in utils/handlers.ts über dieselbe Gruppierung
 * wie die Liste selbst.
 */
/**
 * Antwort auf „gibt es dieses Set schon?" (GET /api/v1/sets/exists/:nummer).
 *
 * Vorher fragte die App `getSetDetail()` und las aus dem FEHLER, ob das Set
 * existiert — das vermischt „nicht vorhanden" mit „Server nicht erreichbar"
 * und zwang zu einer eigenen Auswertung im Client. Jetzt sagt es der Server
 * ausdrücklich, mit derselben Regel, die auch beim Erfassen greift
 * (utils/setAdd.ts).
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
     * Die Antwort ist GERATEN, nicht abgeglichen — bitte hinsehen.
     *
     * Der Server hat sieben Wege zu einer Setnummer; fünf gleichen eine
     * Kennung ab, zwei raten (utils/barcodeQuelle.ts). Bis hierher waren beide
     * nicht zu unterscheiden: Auch der Ratepfad antwortete mit `success: true`
     * und einer konkreten Nummer, und die App zeigte den Bestätigungsdialog,
     * als wäre das Set erkannt worden.
     *
     * Marcos Meldung war genau das: „Es werden regelmässig falsche Nummern
     * erkannt."
     *
     * Vorgabe false: Ein älterer Server kennt das Feld nicht, und dessen
     * Antworten sind nicht schlechter als vorher — der Hinweis fehlt dann
     * bloss.
     */
    val unsicher: Boolean = false,
    val error: String? = null
)

@Serializable
data class GenericResponse(
    val success: Boolean,
    val error: String? = null,
    /**
     * Neu berechnetes Zustands-Aggregat des Sets, wenn die Antwort von einem
     * Schreibvorgang auf set_acquisitions kommt.
     *
     * Der Server liefert es mit, damit der Client die Regel „eine U-Erfassung
     * macht das Set gebraucht" nicht nachbauen muss. Ohne das behielt die
     * Galerie-Kachel nach einer Zustandsänderung im Kaufpreis-Dialog das alte
     * Label, bis die Liste neu geladen wurde.
     */
    val set: SetAggregate? = null,
    /**
     * Was beim Verschieben eines Kaufpreises in ein anderes Konto mitgewandert
     * ist. Der Server liefert die Zahlen seit jeher mit (moveSetBetweenAccounts
     * in utils/setMove.ts) — die App las sie nur nie und zeigte deshalb in der
     * Erfolgsmeldung immer „0 Teile und 0 Minifiguren".
     *
     * Null bedeutet: Die Antwort kam nicht von einem Verschiebe-Vorgang.
     */
    val parts: Int? = null,
    val minifigs: Int? = null,
    @SerialName("source_emptied") val sourceEmptied: Boolean = false,
    /**
     * Die Gesamtmenge des Blickfelds NACH einer Mengenänderung.
     *
     * Angezeigt wird die Menge aller Konten, geschrieben wird die Differenz auf
     * das eigene (Nachtrag 85). Beim VERRINGERN deckelt der Server bei den
     * eigenen Exemplaren — fremde lassen sich nicht wegnehmen —, und dann ist
     * das Ergebnis eine ANDERE Zahl als die gesendete. Der Regler hatte seine
     * lokale Zahl aber schon hochgezählt und stünde bis zum nächsten Laden
     * daneben.
     *
     * Null bedeutet: Die Antwort kam nicht von einer Mengenänderung.
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
 * Das Ergebnis eines CSV-Imports — Sets, Teile oder Minifiguren.
 *
 * ── Eine Huelle fuer drei Adressen (Nachtrag 128) ───────────────────────────
 *
 * /sets/import/csv, /parts/import/csv und /minifigs/import/csv antworten mit
 * denselben Feldern; nur bei den Sets heisst „hinzugefuegt" `imported` statt
 * `added`. Die Alternative waeren drei fast gleiche Datenklassen gewesen —
 * genau die Form, die in diesem Baum wiederholt auseinandergelaufen ist.
 *
 * Alle Zaehler haben einen Vorgabewert: Welches Feld eine Adresse schickt,
 * unterscheidet sich, und ein fehlendes Feld ist kein Fehler, sondern eine
 * Null.
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
 * Welche Art CSV importiert wird.
 *
 * Drei Adressen, dieselbe Bedienung — deshalb ein Aufzaehlungstyp statt drei
 * Aufrufwegen durch die ganze Anwendung. Die Webapp bietet genau diese drei an.
 */
enum class CsvArt { SETS, TEILE, MINIFIGUREN }

// ═══════════════════════════════════════════════════════════════════════════
// Preisalarm — sag Bescheid, wenn ein Set eine Schwelle reisst
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ein Alarm gehoert genau EINEM Konto — anders als alles andere in diesem
 * Modell kennt er kein Blickfeld. Wer eine Schwelle setzt, will selbst
 * benachrichtigt werden; das Elternkonto haette nichts davon, die Merkposten
 * seiner Kinder per Mail zu bekommen.
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
     * Schon gemeldet?
     *
     * Der Alarm meldet den UEBERGANG, nicht den Zustand: Bleibt der Preis
     * unter der Schwelle, bleibt es bei der einen Meldung. Erst wenn er auf
     * die andere Seite zurueckkehrt, wird der Merker geloescht und die
     * naechste Unterschreitung meldet wieder.
     */
    val ausgeloest: Boolean = false,
    @SerialName("zuletzt_am") val zuletztAm: String? = null,
    @SerialName("zuletzt_preis") val zuletztPreis: Double? = null,
    /**
     * Der Setname — NUR aus der Uebersicht (GET /v1/alerts).
     *
     * Die Route zum einzelnen Set schickt ihn nicht: Dort steht der Name schon
     * ueber dem Dialog. In der Uebersicht ist er dagegen das Einzige, was die
     * Zeile lesbar macht — „40820-1" sagt niemandem etwas.
     *
     * Ein zweites Modell nur dafuer waere zwei Modelle, die auseinanderlaufen
     * koennen. `null` heisst hier zweierlei und beides ist richtig: „nicht
     * mitgeschickt" (Einzelroute) oder „dem Katalog unbekannt" (Uebersicht).
     * Die Anzeige behandelt beides gleich — sie laesst die Zeile weg.
     */
    val name: String? = null,
    /**
     * Bildquellen fuer die Zeile der Uebersicht — dieselbe Reihenfolge wie in
     * den Finanzen: erst die vom Server heruntergeladene Kopie, dann die
     * Adresse der eigenen Sammlung, zuletzt die des Katalogs.
     *
     * Die ersten beiden gibt es nur, wenn das Set in der Sammlung liegt; die
     * dritte auch sonst. Bei einem Preisalarm ist gerade der zweite Fall
     * haeufig — man beobachtet oft, was man noch nicht hat.
     *
     * Wie [name] kommen sie NUR aus der Uebersicht (GET /v1/alerts).
     */
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("set_img_url") val setImgUrl: String? = null,
    /**
     * Gibt es zu diesem Set eine Detailansicht?
     *
     * Entscheidet, ob die Zeile anklickbar ist: Die Detailansicht holt
     * `/v1/sets/:nummer`, und die gibt es fuer ein Set ausserhalb des
     * Blickfelds nicht. Ein Alarm ueberlebt das Entfernen des Sets — er
     * haengt am Konto, nicht am Set.
     *
     * ── Warum der Vorgabewert `true` ist (Nachtrag 139) ───────────────────
     *
     * Marcos Befund: „Das Bild ist sichtbar aber die Eintraege sind nicht
     * klickbar." Sein Server war noch der alte und schickte das Feld gar
     * nicht mit; das Bild kam aus `set_img_url`, das es dort schon gab. Mit
     * dem Vorgabewert `false` hiess „Feld fehlt" dasselbe wie „Set gibt es
     * nicht" — und die Rubrik war stillschweigend tot.
     *
     * Ein fehlendes Feld ist aber keine Aussage. `true` heisst hier: im
     * Zweifel versuchen. Auf einem neuen Server schickt die Antwort das Feld
     * IMMER mit, der Vorgabewert greift also nur gegen einen alten — und dort
     * ist ein Klick, der in einer Fehlermeldung endet, allemal besser als
     * eine Liste, in der nichts geht.
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
 * Antwort auf „was hat seit <marke> ausgeloest?".
 *
 * `now` ist der Zeitpunkt des SERVERS und wird zur naechsten Marke — siehe
 * die Begruendung an Alarmabholung. Nullable, damit eine aeltere Serverfassung
 * ohne dieses Feld als „nicht verwertbar" erkannt wird statt still eine leere
 * Marke zu setzen.
 */
@Serializable
data class PendingAlertsResponse(
    val success: Boolean = false,
    val alerts: List<Preisalarm> = emptyList(),
    val now: String? = null,
    val error: String? = null,
)

/**
 * Ein Eintrag der Merkliste.
 *
 * Die Stammdaten (name, year, …) kommen aus dem Katalog und sind NICHT
 * mitgespeichert — die Begruendung steht in der Migration 0021. Ein Set, das
 * der Katalog nicht kennt, hat hier `name == null` und zeigt seine Nummer.
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
     * Die lokal abgelegte Bilddatei — wenn es sie gibt, hat sie Vorrang.
     *
     * Dieselbe Regel wie bei Sets, Teilen und Minifiguren: Was schon auf der
     * Platte des Servers liegt, wird von dort geladen statt ueber den
     * Bild-Proxy vom CDN. Die Merkliste fuehrte das Feld als einzige Liste
     * nicht mit — in der Webapp hat die Sicherheitsrichtlinie die direkten
     * CDN-Aufrufe geblockt (Marcos Befund), am Telefon war es „nur" ein
     * unnoetiger Umweg uebers Netz.
     */
    @SerialName("image_local") val imageLocal: String? = null,
    /** Liegt das Set schon in der Galerie eines Kontos im Blickfeld? */
    /**
     * Marktpreis im Zustand DIESES Merkpostens — null, solange keiner bekannt
     * ist.
     *
     * Marcos Vorgabe vom 24.09.: „Bitte in der Tabelle der Merkliste der
     * Button In die Galerie aufnehme entfernen und dafuer den Marktpreis
     * anzeigen." Der Wert kommt aus dem Preis-Cache des Servers, den
     * jobs/priceJob.ts taeglich fuer die Merkposten auffrischt — kein Abruf je
     * Zeile beim Oeffnen des Reiters.
     */
    val marktpreis: Double? = null,
    /** Die Waehrung, in der [marktpreis] steht. */
    val waehrung: String = "EUR",
    val owned: Boolean = false,
    /**
     * Der Preisalarm zu GENAU diesem Merkposten — oder null.
     *
     * Er reist mit, statt je Zeile einzeln geholt zu werden: Wer einen Alarm
     * setzt und ihn danach nirgends mehr sieht, hat ihn verloren, und ein
     * Aufruf je Zeile waere N+1 fuer eine Liste, die auch lang sein kann.
     */
    val alarm: MerkpostenAlarm? = null,
    /**
     * Preisvergleich — die Adresse fuer den Knopf im Detail.
     *
     * Sie kommt mit dem Merkposten, nicht aus /catalog/sets/:nr: Ein Set, das
     * rb_sets nicht kennt, beantwortet die Katalogroute mit 404 — und dann
     * blieb der Knopf aus, obwohl die Adresse aus der Setnummer allein zu
     * bilden ist. Die Begruendung steht in utils/merkliste.ts.
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
 * Den Inhaber eines Merkpostens wechseln.
 *
 * ZWEI Konten im Rumpf, und beide sind noetig: Der Server muss wissen, WOHER
 * er umhaengt — die Auswahl im Bildschirm kennt nur das Ziel, und der
 * Betrachter ist nicht zwingend der bisherige Inhaber (der Grossvater sieht
 * die Merkposten der Enkel).
 */
@Serializable
data class MerkpostenInhaberRequest(
    @SerialName("owner_user_id") val ownerUserId: Int,
    @SerialName("neuer_inhaber") val neuerInhaber: Int,
)

/**
 * Antwort auf den Inhaberwechsel.
 *
 * `zusammengefuehrt` heisst: Das Zielkonto hatte denselben Merkposten schon, die
 * Quelle ist verschwunden statt umgezogen. Ohne diese Unterscheidung meldete
 * die Oberflaeche „verschoben", wo etwas weg ist.
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

/**
 * Antwort auf das Eintragen.
 *
 * `war_neu` unterscheidet „hinzugefuegt" von „stand schon drauf". Ohne das
 * saehe der zweite Druck auf denselben Knopf aus wie der erste.
 */
@Serializable
data class MerkpostenAntwort(
    val success: Boolean = false,
    @SerialName("war_neu") val warNeu: Boolean = false,
    val merkposten: Merkposten? = null,
    val error: String? = null,
)

/**
 * Antwort auf die Uebernahme in die Galerie.
 *
 * `action` ist 'added' oder 'exists' — dasselbe Vokabular wie beim Erfassen
 * eines Sets, weil der Server dafuer dieselbe Funktion ruft (addSet).
 */
@Serializable
data class MerkpostenUebernahmeResponse(
    val success: Boolean = false,
    val action: String? = null,
    @SerialName("set_number") val setNumber: String? = null,
    val error: String? = null,
)

/**
 * Was bei der Uebernahme mitgeht.
 *
 * Menge und Kaufpreis wie beim Erfassen eines Sets — der Server reicht sie an
 * addSet() weiter. Beide optional: Ohne Kaufpreis setzt der Server den
 * Marktpreis ein, genau wie auf dem normalen Erfassungsweg.
 */
@Serializable
data class MerkpostenUebernahmeRequest(
    val quantity: Int = 1,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    /**
     * Der Zustand, in dem ERFASST wird — nicht der des Merkpostens.
     *
     * Die beiden sind nicht dasselbe: Wer sich ein gebrauchtes gewuenscht und
     * ein neues gefunden hat, erfasst ein neues, und erledigt ist trotzdem der
     * gebrauchte Merkposten. Welcher Merkposten verschwindet, entscheidet der Pfad;
     * dieses Feld entscheidet nur, was in der Galerie steht.
     *
     * null = so lassen wie der Merkposten.
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
 * Die Marktpreise eines Merkpostens — BEIDE Zustaende.
 *
 * Dieselbe Form wie `current` in der Verlaufsantwort, damit die Oberflaeche
 * sie mit derselben Zeichenfunktion anzeigen kann.
 */
@Serializable
data class MerkpostenPreiseResponse(
    val success: Boolean = false,
    val currency: String = "",
    val current: CurrentByCondition = CurrentByCondition(),
    val error: String? = null,
)
