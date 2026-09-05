package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.*

/**
 * UI-Zustandsklassen — aus MainViewModel.kt extrahiert.
 * AppUiState ist der Haupt-Zustand; CsvImportUiState, SetDetailUiState
 * und der Snackbar-Flow sind bewusst separat, damit deren hochfrequente
 * Updates nicht alle AppUiState-Konsumenten rekomponieren.
 */
/** Zustand der Haushalts-Karte in den Einstellungen. */
data class HouseholdUiState(
    val isLoading: Boolean = false,
    val status: ch.brickinventoryapp.data.model.HouseholdStatusResponse? = null,
    /** Zuletzt erzeugter Einladungscode — nur bis zum Verlassen der Ansicht. */
    val inviteCode: String? = null,
    /** Meldung des Servers (Währung weicht ab, schon verknüpft, zweite Stufe). */
    val message: String? = null,
)

/**
 * Die ausgestellten Zugänge dieses Kontos — „Angemeldete Geräte".
 *
 * Eigener Fluss und nicht Teil von AppUiState: Die Liste wird nur in den
 * Einstellungen gebraucht, hat eigene Zwischenstände (lädt, Fehler) und würde
 * sonst jeden Reiter neu zeichnen lassen. Dieselbe Überlegung wie bei
 * HouseholdUiState darüber.
 */
data class GeraeteUiState(
    val laedt: Boolean = false,
    val geraete: List<ch.brickinventoryapp.data.model.AppToken> = emptyList(),
    /** Meldung des Servers oder der Verbindung; null = nichts zu sagen. */
    val fehler: String? = null,
)

/**
 * Welches der drei Formulare der Anmeldebildschirm gerade zeigt.
 *
 * Dieselben drei wie in der Webapp (`showPanel` in public/js/01-core.js):
 * anmelden, ein Konto anlegen, einen Link zum Zuruecksetzen anfordern.
 */
enum class AnmeldeFormular { ANMELDEN, REGISTRIEREN, PASSWORT_VERGESSEN }

/**
 * Konto anlegen und „Passwort vergessen" — ein eigener Zustand.
 *
 * ── Warum nicht in AppUiState (Nachtrag 126) ────────────────────────────────
 *
 * Dort standen diese fuenf Felder zuerst, und ZustandsflussBreiteTest hat es
 * gemeldet: „AppUiState hat 20 Felder (erlaubt: 15). Gehoert es wirklich allen
 * — oder ist es der Anfang der naechsten Domaene?" Es ist der Anfang der
 * naechsten Domaene. Sechzehn Dateien sammeln AppUiState ein; keine davon
 * ausser dem Anmeldebildschirm liest je, welches Formular gerade offen ist.
 *
 * Die Anmeldung SELBST bleibt drueben (`loginLaeuft`, `loginError`,
 * `isLoggedIn`): An ihr haengt, ob die App ueberhaupt etwas zeigt. Was hier
 * steht, sind die beiden Wege DANEBEN — ein Konto anlegen und einen Link
 * anfordern. Beide enden nicht in einer Anmeldung, sondern in einem Satz des
 * Servers.
 */
/**
 * Das eigene Konto im Einstellungs-Bildschirm — eigener Zustand.
 *
 * Aus demselben Grund wie AnmeldeUiState darunter: AppUiState steht bei 14 von
 * 15 erlaubten Feldern (ZustandsflussBreiteTest), und Profil und
 * Passwortwechsel liest genau EIN Bildschirm.
 *
 * Was hier NICHT steht, ist ein Feld „abgemeldet". Ein erfolgreicher
 * Passwortwechsel meldet die App ab — der Server verwirft dabei alle Zugaenge
 * des Kontos, auch den dieser Anfrage. Der erste Entwurf merkte sich das hier;
 * gelesen haette es nie jemand, weil logout() im selben Zug alle Fluesse
 * zuruecksetzt und der Anmeldebildschirm erscheint. Die Erklaerung dafuer geht
 * deshalb in den Snackbar, der das ueberlebt. (Gefunden von der Regel „kein
 * Feld ohne Leser".)
 */
/**
 * Eine CSV-Datei hochladen — eigener Zustand.
 *
 * ── Warum die App das erst jetzt kann (Nachtrag 128) ────────────────────────
 *
 * Sie hat CSV-Importe bisher nur BEOBACHTET: Der Fortschrittsbalken
 * (CsvImportUiState) haengt an einem Ereigniskanal des Servers und zeigt, was
 * jemand anderes gestartet hat — in aller Regel die Webapp. Starten konnte die
 * App keinen, und zwar aus zwei Gruenden: Es fehlte die Dateiauswahl, und die
 * drei Adressen lagen hinter einem Waechter, der nur Browser-Sitzungen kannte
 * (Nachtrag 127).
 *
 * Das hier ist der HOCHLADE-Vorgang, nicht der Import-Fortschritt. Die beiden
 * sind bewusst getrennt: Das Hochladen dauert Sekunden und endet mit einer
 * Zahl; der Import danach laeuft auf dem Server weiter und meldet sich ueber
 * den bestehenden Kanal. Sie in ein Feld zu legen hiesse, zwei Vorgaenge mit
 * verschiedener Lebensdauer denselben Fortschritt teilen zu lassen.
 */
/**
 * Das Server-Protokoll — eigener Zustand fuer Verwalter.
 *
 * Es liest genau EIN Bildschirm, und fuer die meisten Nutzer ist es nie
 * sichtbar. In AppUiState laege es sechzehn Dateien im Weg, die es nie lesen
 * (ZustandsflussBreiteTest).
 *
 * Hier standen zusaetzlich die Felder der Nutzerverwaltung (`kontenLaden`,
 * `konten`). Sie sind auf Marcos Entscheidung entfallen — Konten verwaltet man
 * am Rechner (Nachtrag 129). Der Name der Klasse bleibt: Sie traegt, was ein
 * Verwalter in der App sieht.
 */
data class VerwaltungUiState(
    val protokollLaden: Boolean = false,
    val protokoll: List<ch.brickinventoryapp.data.model.ProtokollZeile> = emptyList(),
    /** Zeitspanne des Protokolls in Minuten — der Server begrenzt auf 2880. */
    val protokollMinuten: Int = 15,
    val fehler: String? = null,
)

data class CsvHochladenUiState(
    val laeuft: Boolean = false,
    /** Welche Art gerade hochgeladen wird — fuer die Anzeige am richtigen Knopf. */
    val art: ch.brickinventoryapp.data.model.CsvArt? = null,
    val ergebnis: ch.brickinventoryapp.data.model.CsvImportErgebnis? = null,
    val fehler: String? = null,
)

data class KontoUiState(
    val laedt: Boolean = false,
    val profil: ch.brickinventoryapp.data.model.Profil? = null,
    val speichert: Boolean = false,
    val meldung: String? = null,
    val fehler: String? = null,
)

data class AnmeldeUiState(
    /**
     * Welches der drei Formulare der Anmeldebildschirm gerade zeigt.
     *
     * Genau wie in der Webapp, wo `showPanel('login'|'register'|'forgot')`
     * zwischen denselben drei umschaltet. Ein eigener Navigationseintrag waere
     * die zweite Wahrheit: Der Zurueck-Knopf des Geraets muesste dann etwas
     * anderes bedeuten als das „Zurueck zur Anmeldung" im Formular.
     */
    val formular: AnmeldeFormular = AnmeldeFormular.ANMELDEN,
    /**
     * Steht die Registrierung offen? `null` = noch nicht gefragt.
     *
     * Der Unterschied traegt: Bei `null` zeigt der Bildschirm den Link NICHT —
     * und bei `false` auch nicht. Ein Knopf, der erst erscheint und beim
     * Antippen an einem 403 scheitert, ist schlechter als keiner. Der Server
     * kann Registrierungen global abschalten (registration_enabled), und die
     * Webapp blendet den Link genau so aus.
     */
    val registrierungOffen: Boolean? = null,
    /**
     * Die Antwort auf Registrieren oder „Passwort vergessen" — der SATZ DES
     * SERVERS, nicht ein eigener.
     *
     * Bei „Passwort vergessen" ist das wesentlich: Der Server antwortet
     * absichtlich immer gleich („Falls die E-Mail existiert …"), damit das
     * Formular nicht verraet, wer hier ein Konto hat. Wuerde die App daraus
     * eine eigene Erfolgsmeldung machen, waere die Vorsicht des Servers
     * umsonst.
     */
    val meldung: String? = null,
    val fehler: String? = null,
    val laeuft: Boolean = false,
)

data class AppUiState(
    /**
     * Läuft gerade eine ANMELDUNG? Und nur das.
     *
     * ── Warum das Feld umbenannt wurde ──────────────────────────────────────
     * Es hiess `isLoading` und war das letzte querschneidende Feld des
     * gemeinsamen Zustands — StateDomainBoundaryTest führte es ausdrücklich als
     * den Grund, warum es AppUiState als geteiltes Objekt überhaupt noch gibt.
     *
     * NACHGEMESSEN: Geschrieben wurde es von vier Feature-Dateien an
     * dreiundzwanzig Stellen (Sitzung 8, Teile 8, Galerie 4, Finanzen 3),
     * GELESEN an fünf — und die fünf meinten vier verschiedene Dinge:
     *   • AuthGraph        → „die Anmeldung läuft" (Knopf sperren)
     *   • GalleryScreen    → „die Galerie lädt" (Aktualisieren-Kringel)
     *   • CollectionGraph  → „die Galerie lädt" (Nachlade-Wächter)
     *   • FinanceScreen    → „die Bewertung lädt"
     *   • loadMoreSets()   → „die Galerie lädt" (Wächter gegen Doppelabruf)
     *
     * Ein Feld, vier Bedeutungen — das hatte Folgen, die über Rekomposition
     * hinausgehen:
     *   • Die Teileliste schrieb es, obwohl KEIN Teile-Bildschirm es liest
     *     (dort gibt es partsLoading/minifigsLoading). Wirkung hatte es nur
     *     woanders: `addPart()` liess die Galerie beschäftigt aussehen und
     *     blockierte über den Wächter in loadMoreSets() das Nachladen.
     *   • Wer schneller fertig war, gewann. `loadValuation()` setzte am Ende
     *     `false` — mitten in einen noch laufenden Galerie-Abruf hinein. Der
     *     Wächter gab damit einen zweiten Abruf frei, der Kringel verschwand
     *     zu früh.
     *
     * Jede der vier Bedeutungen hat jetzt ihr eigenes Feld in ihrer eigenen
     * Domäne: `galleryLoading`, `valuationLoading`, `partsLoading` (bestand
     * schon) — und dieses hier für die Anmeldung.
     */
    val loginLaeuft: Boolean = false,
    /**
     * Fehler des ANMELDEFORMULARS — und nur der.
     *
     * ── Warum der Name so eng ist (Nachtrag 118) ────────────────────────────
     * Das Feld hiess `error` und wurde von vier Feature-Dateien beschrieben:
     * Anmeldung, Galerie, Teile, Finanzen — vierundzwanzig Stellen. GELESEN
     * wurde es an genau EINER: dem Anmeldebildschirm. Achtzehn Fehlerpfade
     * schrieben also in ein Feld, das niemand anzeigt. Ein fehlgeschlagenes
     * Löschen einer Minifigur, ein misslungener Bewertungsabruf, eine leer
     * gebliebene Galerie — der Nutzer sah nichts. `clearError()` hatte dazu
     * passend null Aufrufer.
     *
     * Der Grund war ein zweiter, unfertiger Meldungsweg neben `_snackbar`:
     * Beide gab es, eine Regel welcher wofür gilt gab es nicht, und einer war
     * nirgends verdrahtet. Der Name sagt jetzt, wofür das Feld da ist —
     * flüchtige Meldungen gehen in den Snackbar, DIESES bleibt stehen, weil
     * der Anmeldefehler im Formular sichtbar bleiben muss, während der Nutzer
     * das Passwort korrigiert.
     *
     * CatalogUiState hat weiterhin ein eigenes `error`: Der Katalog ZEIGT es
     * (ganzseitige Fehlerfläche mit Erneut-Knopf), es ist also verdrahtet.
     *
     * Gesichert durch ErrorChannelTest.
     */
    val loginError: String? = null,
    val serverUrl: String = "",
    val isLoggedIn: Boolean = false,
    val isAdmin: Boolean = false,
    // `username` stand hier und wurde aus den Einstellungen gefuellt — gelesen
    // hat es niemand. Was die Oberflaeche zeigt, ist `HouseholdMember.username`
    // aus der Haushalts-Antwort, ein anderer Wert. Gefunden von der Regel
    // „kein Zustandsfeld wird geschrieben, ohne je gelesen zu werden"
    // (UiStateFieldsTest).
    val authToken: String = "",
    val currency: String = "EUR",
    /**
     * Kontofilter JE ANSICHT (Schlüssel aus ScopeFilter.View).
     *
     * Der Wert reist als `accounts=` mit und wird ausschliesslich auf dem
     * Server in Konto-IDs übersetzt — dadurch kennt ihn jede Zahl derselben
     * Antwort: Liste, Gesamtzahl, Kennzahlen und Summen.
     */
    val scopeModes: Map<String, String> = emptyMap(),
    /**
     * Konten des Haushalts, eigenes zuerst. Mehr als einer heisst: Hauptkonto
     * mit Unterkonten — erst dann erscheinen Kontofilter, Kontoauswahl beim
     * Erfassen und der Verschieben-Weg.
     */
    val householdMembers: List<ch.brickinventoryapp.data.model.HouseholdMember> = emptyList(),
    val priceCondition: String = "N",
    val defaultPriceCondition: String = "N", // server-side default condition for new items (N=New, U=Used)
    val userDefaultCondition: String? = null, // null = use global default
    val appTheme: String = "classic", // global vom Admin gewähltes App-Design
    /**
     * Startzustand des Servers, solange er nicht `ready` meldet; sonst null.
     *
     * ── Warum das im Zustand steht (Nachtrag 136) ───────────────────────────
     *
     * Der erste Start einer Neuinstallation dauert viele Minuten — der Server
     * holt den Katalog. Die App zeigte in dieser Zeit ihre allgemeine
     * Netzmeldung; wer seinen Server frisch aufsetzt, haelt dann App oder
     * Server fuer kaputt. Die Webapp zeigt seit jeher einen Fortschrittsbalken
     * (public/js/01-core.js).
     *
     * `null` heisst „nichts Besonderes" — entweder ist der Server durch, oder
     * er ist gar nicht erreichbar. Nur wenn er ANTWORTET und `ready` falsch
     * meldet, steht hier etwas, und nur dann zeigt die Anmeldung den Balken
     * statt des Formulars.
     */
    val startupStatus: ch.brickinventoryapp.data.model.StartupStatus? = null,
    val language: String = "system",
)

/**
 * Galerie: Liste, Filter, Blaetterstand und Kennzahlen.
 *
 * ── Warum diese zehn Felder aus AppUiState heraus mussten ───────────────────
 * NACHGEMESSEN, nicht vermutet: SECHZEHN Dateien sammeln `vm.state`. Gelesen
 * werden die Galerie-Felder aber nur von dreien (GalleryScreen,
 * CollectionGraph, SetDetailScreen). Die uebrigen dreizehn wurden bei jedem
 * Blaettern, jeder Suche und jedem Nachladen neu zusammengesetzt, ohne ein
 * einziges dieser Felder zu lesen — Minifiguren, Finanzen, Einstellungen, die
 * Navigationsleiste.
 *
 * Und gerade die Galerie ist der Zustand, der sich am haeufigsten aendert:
 * `galleryLoadingMore` allein wird an fuenf Stellen geschrieben, `sets` an
 * sechs.
 *
 * Es ist dasselbe Muster, das fuer Teile, Finanzen, Katalog und den Barcode
 * schon vollzogen wurde (Nachtraege 117 ff.) — bei der Galerie war es
 * steckengeblieben, ausgerechnet beim groessten und lautesten Block.
 */
data class GalleryUiState(
    val sets: List<SetItem> = emptyList(),
    /**
     * Galerie-Filter — ausgewertet wird er auf dem SERVER (Marcos Vorgabe).
     * Hier steht nur, was gerade eingestellt ist, damit die Oberfläche es
     * anzeigen und die nächste Seite mit denselben Werten nachladen kann.
     */
    val galleryQuery: String = "",
    val galleryTheme: String = "",
    val gallerySort: String = ch.brickinventoryapp.data.repository.GALLERY_DEFAULT_SORT,
    /** Themen des ganzen Bestands — vom Server, nicht aus der geladenen Seite. */
    val galleryThemes: List<String> = emptyList(),
    val galleryTotal: Int = 0,
    val galleryPage: Int = 1,
    /**
     * Erste Seite / Neuladen. `galleryLoadingMore` ist das Gegenstück fürs
     * Anhängen — getrennt, weil die Oberfläche beide unterschiedlich zeigt
     * (Kringel oben gegen Fussleiste unten) und der Wächter in loadMoreSets()
     * beide braucht.
     *
     * Kam aus AppUiState.isLoading hierher: Dort teilte sich die Galerie das
     * Feld mit Anmeldung, Teileliste und Bewertung. Siehe AppUiState.loginLaeuft.
     */
    val galleryLoading: Boolean = false,
    val galleryLoadingMore: Boolean = false,
    val stats: DashboardStats? = null,

    // Gallery "Search by barcode" flow
    // Auslöser für „öffne die Detailansicht dieses Sets". Gesetzt vom
    // Barcode-Scanner im Modus "gallery_search" UND seit Nachtrag 57 auch beim
    // Erfassen über die Setnummer, wenn das Set bereits vorhanden ist. Der Name
    // stammt aus der ersten Verwendung; gemeint ist beides.
    val gallerySearchFoundSetNumber: String? = null,   // → navigate to SetDetail
)


/**
 * Teile & Minifiguren — eigener Flow (gleiches Muster wie CatalogUiState).
 *
 * Diese Felder lagen bis zuletzt in AppUiState. Folge: Jedes `partsLoading`
 * beim Blättern durch die Teileliste rekomponierte auch die Galerie, die
 * Navigationsleiste und alles andere, was AppUiState liest — obwohl nur zwei
 * Screens diese Daten überhaupt brauchen.
 */
data class PartsUiState(
    val parts: List<Part> = emptyList(),
    /**
     * Die manuell erfassten Teile — aus /api/v1/parts/manual, derselben
     * Quelle wie die Webapp.
     *
     * Sie kamen bisher aus der BEWERTUNG (FinanceUiState.partsValuation).
     * Zwei Quellen fuer dieselbe Liste, und die App lud dafuer jedes Mal die
     * ganze Bewertung samt Marktpreis-Abfragen — obwohl die Kachel nur
     * Nummer, Name, Farbe, Zustand, Bild, Menge und Besitzer zeigt.
     *
     * NULL heisst „noch nicht geladen", eine leere Liste „keine vorhanden".
     * Der Unterschied traegt: Die Wiederherstellung der Rollposition wartet
     * darauf, dass die Liste DA ist — auf `isNotEmpty()` zu warten hiesse,
     * dass sie bei jemandem ohne eigene Teile nie wiederhergestellt wuerde
     * (so stand es schon einmal da, siehe CollectionGraph).
     */
    val manualParts: List<ch.brickinventoryapp.data.model.PartValuationItem>? = null,
    val partsTotal: Int = 0,
    val partsPage: Int = 1,
    /**
     * Der Suchtext der Teileliste — im ZUSTAND, nicht im Bildschirm.
     *
     * Er stand als `var searchQuery by rememberSaveable` in PartsScreen und
     * wurde jedem Ladeaufruf als Argument mitgegeben. Jeder Weg, der die Liste
     * NICHT aus dem Suchfeld heraus nachlud, kannte ihn damit nicht:
     * `onLoadMore` holte Seite 2 ungefiltert und haengte sie an eine
     * gefilterte Seite 1, und `partsTotal` kam aus der ungefilterten Abfrage.
     * Ebenso nach dem Loeschen eines manuellen Teils, nach einem Wechsel des
     * Kontofilters und beim Betreten des Reiters.
     *
     * Die Galerie macht es seit jeher so (galleryQuery daneben) — dort liest
     * JEDER Lader den Filter aus dem Zustand, und genau deshalb gab es das
     * Problem dort nicht.
     */
    val partsQuery: String = "",
    /**
     * Ersatzteil-Filter: "" alle, "0" ohne Ersatzteile, "1" nur Ersatzteile.
     *
     * Dieselben drei Werte wie das Auswahlfeld der Webapp (parts-spare in
     * index.html). Die App las `is_spare` bisher zwar aus der Antwort und hatte
     * sogar einen Helfer dafuer (Part.isSpareFlag) — benutzt hat sie beides
     * nirgends. Wer am Telefon nachsah, wie viele Teile er wirklich hat, bekam
     * die Ersatzteile immer mitgezaehlt; am Rechner konnte er sie ausblenden.
     *
     * Aus demselben Grund wie partsQuery im Zustand und nicht im Bildschirm:
     * Sonst kennt ihn nur, wer aus dem Filter heraus laedt, und `onLoadMore`
     * haengt eine ungefilterte Seite 2 an eine gefilterte Seite 1.
     */
    val partsSpare: String = "",
    /**
     * Darstellung der Teileliste: "grid" (Karten) oder "table" (Zeilen).
     *
     * Wie in der Webapp (Auswahlfeld parts-view). Im Zustand und nicht im
     * Bildschirm, weil der Ladeweg ihn braucht: Die Spalte „In Sets" kostet
     * den Server eine eigene Abfrage, deshalb holt die Webapp `with_sets=1`
     * NUR in der Tabellenansicht — und die App tut es genauso.
     */
    val partsView: String = "grid",
    /**
     * Die beiden Filterlisten des Reiters — Farbe und Kategorie, mit Anzahl.
     *
     * ── Warum sie fehlten (Nachtrag 134) ────────────────────────────────────
     *
     * Gemessen, nicht gelesen: Ein Vergleich der Server-Adressen beider
     * Clients zeigte 21 Adressen, die nur die Webapp ruft — darunter
     * /parts/colors und /parts/categories. Die App bot im Teile-Reiter
     * ausschliesslich die Suche.
     *
     * Bemerkenswert war der Zustand der Leitung: `BrickApiService.getParts`
     * deklariert `@Query("color")` und `@Query("category")` seit jeher, und
     * `TeileRepository.getParts` reicht beide durch. Nur gesetzt hat sie nie
     * jemand — eine halbfertige Funktion, die in keiner Pruefung auffiel, weil
     * Vorgabewerte kein toter Code sind.
     */
    val partsFilterColors: List<ch.brickinventoryapp.data.model.PartsFilterColor> = emptyList(),
    val partsCategories: List<ch.brickinventoryapp.data.model.PartsCategory> = emptyList(),
    /** Gewaehlte Farbe; "" = alle. Der Wert reist als `color=` mit. */
    val partsColorFilter: String = "",
    /**
     * Gewaehlte Kategorie; "" = alle.
     *
     * Gespeichert wird der WERT (`category_name`, meist eine Katalog-ID als
     * Text), nicht die Beschriftung — der Server filtert danach.
     */
    val partsCategoryFilter: String = "",
    val partsLoading: Boolean = false,
    val minifigs: List<Minifig> = emptyList(),
    /** Die manuell erfassten Figuren — siehe manualParts, null wie dort. */
    val manualFigs: List<ch.brickinventoryapp.data.model.FigValuationItem>? = null,
    /** Kennzahlen der Kacheln — vom Server, nicht aus der (gefilterten) Liste. */
    val minifigStats: ch.brickinventoryapp.data.model.MinifigStats =
        ch.brickinventoryapp.data.model.MinifigStats(),
    val minifigsLoading: Boolean = false,
    /**
     * Suchtext der Figurenliste — im Zustand, nicht im Composable.
     *
     * Er stand als `var search by rememberSaveable` in MinifigsScreen und
     * filterte die schon geladene Liste. Damit gab es dieselbe Suchregel
     * zweimal (hier und im Server-Handler), und sie waren nicht deckungsgleich:
     * Der Server sucht vor der Gruppierung ueber jede fig_name-Zeile, das
     * Composable danach ueber die eine, die uebrig bleibt. Aus demselben Grund
     * steht partsQuery oben im Zustand.
     */
    val minifigsQuery: String = "",
    /**
     * Darstellung der Figurenliste: "grid" oder "table" — wie figs-view in der
     * Webapp. Anders als bei den Teilen braucht der Ladeweg ihn nicht (es gibt
     * keine zusaetzliche Spalte vom Server), er steht aber aus demselben Grund
     * hier: Beim Zuruecknavigieren soll die Ansicht dieselbe sein.
     */
    val minifigsView: String = "grid",
    val partsStats: PartsStats? = null,
    val partsColors: List<BrickColor> = emptyList(),
)

/**
 * Finanzen: Bewertung, Gewinn/Verlust und Portfolio-Verlauf — ebenfalls aus
 * AppUiState herausgelöst.
 *
 * Der Verlauf wird beim Wechsel des Zeitraums komplett geleert und neu
 * geladen; als Teil des Haupt-States löste allein das eine App-weite
 * Rekomposition aus.
 */
data class FinanceUiState(
    val valuation: ValuationResponse? = null,
    val partsValuation: PartsValuationResponse? = null,
    val figsValuation: FigsValuationResponse? = null,
    val pnl: PnlResponse? = null,
    /**
     * Die Bewertung wird geholt. Kam aus AppUiState.isLoading — dort setzte
     * ausgerechnet `loadValuation()` das Feld am Ende auf `false` und beendete
     * damit die Ladeanzeige einer fremden Domäne (siehe AppUiState.loginLaeuft).
     */
    val valuationLoading: Boolean = false,
    val historyLoading: Boolean = false,
    val historyPeriodChangePct: Double? = null,
    val historyPoints: List<ChartPoint> = emptyList(),
    val historyYAxis: List<ChartYAxis> = emptyList(),
    val historyPeriod: String = "week",
)

/**
 * CSV-Import-Fortschritt — bewusst vom Haupt-State getrennt: Während eines
 * Imports wird dieser Zustand alle 1.5s aktualisiert. Als Teil des grossen
 * AppUiState hätte jedes Update die gesamte App rekomponiert; als eigener
 * Flow rekomponiert nur die Stelle, die ihn tatsächlich sammelt (Banner).
 */
data class CsvImportUiState(
    val running: Boolean = false,
    val done: Int = 0,
    val total: Int = 0,
    val current: String? = null,
    val ok: Int = 0,
    val warn: Int = 0,
    val err: Int = 0,
)

/**
 * Set-Detail-Zustand — getrennt vom Haupt-State (gleiches Muster wie
 * CsvImportUiState): Preis- und History-Loads im Detail-Screen haben sonst
 * bei jedem Update alle Composables rekomponiert, die AppUiState lesen,
 * obwohl nur der SetDetailScreen diese Felder braucht.
 */
data class SetDetailUiState(
    val setDetail: SetItem? = null,
    val setDetailLoading: Boolean = false,
    val setPrice: SetPriceResponse? = null,
    val setPriceLoading: Boolean = false,
    // Die ganze Antwort statt einzelner Felder: Sie trägt seit der
    // Server-Umstellung beide Verlaufsreihen, die fertigen Diagrammdaten, die
    // aktuellen Preise und die Bewertung je Zustand. Einzeln herausgezogen
    // müsste jedes neue Feld hier UND in loadSetPriceHistory nachgeführt
    // werden — die Antwort ist bereits das Modell.
    val priceHistory: PriceHistoryResponse? = null,
    val priceHistoryLoading: Boolean = false,
    val acquisitions: List<ch.brickinventoryapp.data.model.Acquisition> = emptyList(),
    /**
     * Summenzeile der Erfassungen — vom Server gerechnet, nicht hier.
     * Die Ansicht zeigt sie nur an; die Regel steht in utils/acquisitions.ts.
     */
    val acquisitionTotals: ch.brickinventoryapp.data.model.AcquisitionTotals =
        ch.brickinventoryapp.data.model.AcquisitionTotals(),
    val acquisitionsLoading: Boolean = false,
)

/**
 * Zustand für den Detail-Dialog manuell erfasster Teile und Minifiguren.
 * Getrennt vom Haupt-State damit Acquisition-Updates (die beim Editieren
 * häufig vorkommen) nicht die gesamte App rekomponieren.
 */
data class ManualItemDetailUiState(
    val acquisitions: List<ch.brickinventoryapp.data.model.Acquisition> = emptyList(),
    /** Summenzeile vom Server — siehe SetDetailUiState.acquisitionTotals. */
    val acquisitionTotals: ch.brickinventoryapp.data.model.AcquisitionTotals =
        ch.brickinventoryapp.data.model.AcquisitionTotals(),
    val isLoading: Boolean = false,
    // Identifiziert das aktuell geöffnete Element
    val itemType: String = "",       // "part" | "fig"
    val itemId: String = "",         // part_number oder fig_number
    val colorId: Int = 0,
    // `newQuantity` stand hier — die Gesamtmenge nach dem Loeschen einer
    // Erfassung. Gelesen wurde sie nie, und sie wird auch nicht gebraucht: Die
    // angezeigte Menge folgt der SUMME der Erfassungen
    // (ManualItemDetailScreen), und die laedt deleteManualAcquisition()
    // unmittelbar danach neu.
    /**
     * Marktpreis je Zustand und Verlauf — dieselbe Antwortform wie beim Set.
     *
     * Bis hardened-96 gab es die beiden Endpunkte nur für die Webapp; der
     * Dialog hier zeigte deshalb Kaufpreise, aber keinen Marktpreis.
     */
    val priceHistory: PriceHistoryResponse? = null,
    val priceHistoryLoading: Boolean = false,
)

/**
 * Katalog-Zustand — eigener Flow (wie SetDetail/CsvImport): Suche und
 * Paging aktualisieren häufig; als Teil von AppUiState würde jede
 * Katalog-Seite die gesamte App rekomponieren.
 */
/**
 * Zustand rund um den Barcode-/OCR-Scanner.
 *
 * ── Warum eigener Fluss (Nachtrag 117) ──────────────────────────────────────
 * Diese zwölf Felder lagen in `AppUiState` — dem gemeinsamen Objekt, an dem
 * jeder Reiter hängt. Jede Änderung während eines Scans (und das sind viele:
 * Zwischenstände beim Auflösen, Sperre gegen den zweiten Klick) rekomponierte
 * damit Galerie, Teile, Minifiguren und Finanzen mit, obwohl der Scanner sie
 * nichts angeht. Dieselbe Begründung, aus der `_snackbar`, `PartsUiState` und
 * `FinanceUiState` schon eigene Flüsse haben.
 *
 * Die Feldnamen behalten den `barcode`-Vorsatz NICHT — innerhalb dieser Klasse
 * wäre er eine Wiederholung des Klassennamens. Am Zugriffsort steht dafür
 * `barcodeState.setName` statt `state.barcodeSetName`, was dieselbe Länge hat
 * und die Herkunft deutlicher macht.
 */
data class BarcodeUiState(
    val result: String? = null,
    /** "gallery", "gallery_search" oder "partslist". */
    val source: String = "gallery",
    /**
     * Der Scan blieb ohne Setnummer → die manuelle Erfassung soll aufgehen.
     *
     * ── Marcos Vorgabe (Nachtrag 113) ────────────────────────────────────────
     * „Wenn der Barcode erkannt wurde, aber die API keine Setnummer liefert,
     * oder wenn die Texterkennung keine Nummer erkennt, soll automatisch die
     * manuelle Erfassung erscheinen — an allen Stellen, wo der Barcodescanner
     * eingebaut ist."
     *
     * Ein Zustandsfeld statt eines Aufrufs je Bildschirm: Die drei erfolglosen
     * Wege liegen alle im ViewModel (EAN nicht auflösbar, EAN ohne Setnummer,
     * Texterkennung ohne Treffer). Wer den Scanner einbindet, liest das Feld
     * und öffnet seinen eigenen Erfassen-Dialog — die Galerie den für Sets, die
     * Teileliste ihren eigenen.
     */
    val manuelleErfassungAnfordern: Boolean = false,
    val fuerTeileliste: String? = null,
    val setName: String? = null,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val year: Int? = null,
    val pieces: Int? = null,
    val theme: String? = null,
    val minifigs: Int? = null,
    // Läuft gerade ein Hinzufügen aus dem Barcode-Dialog? Sperrt den Knopf
    // gegen den zweiten Klick, der sonst dasselbe Set ein zweites Mal erfasst.
    val adding: Boolean = false,
    /**
     * Die angezeigte Nummer ist GERATEN — der Dialog weist darauf hin.
     *
     * Zwei Quellen setzen das Feld:
     *  - Der Server, wenn er die EAN nicht abgleichen konnte und nur einen
     *    plausiblen Kandidaten hat (BarcodeResponse.unsicher).
     *  - Die App selbst bei der Texterkennung: Dort ist schon das LESEN eine
     *    Vermutung. Die gefundene Zahl ergibt zwar ein echtes Set — sonst käme
     *    der Dialog gar nicht —, aber ob es das Set auf dem Papier ist, weiss
     *    niemand.
     *
     * Der Dialog zeigt Bild und Namen ohnehin. Es fehlte nur der Hinweis,
     * WANN man hinsehen muss.
     */
    val unsicher: Boolean = false,
)

/**
 * Welche Frage beantwortet die App gerade, bevor ein Set erfasst wird?
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 * „Wenn man mit dem Barcode oder auch manuell ein Set erfasst, sieht man nicht,
 * dass die App am Prüfen ist, ob man das Set bereits besitzt. Erst das
 * effektive Hinzufügen soll im Hintergrund passieren — sonst passiert es, dass
 * man zu schnell Sets einscannt."
 *
 * Genau so war es. Der Scanner-Bildschirm ruft `popBackStack()` SOFORT und
 * startet die Auflösung erst danach (nav/ToolsGraph.kt) — die Kamera ist also
 * schon weg, während die eigentliche Arbeit noch läuft:
 *
 *   • `resolveBarcode()` löste die EAN auf (bis zu acht Rebrickable-Abrufe)
 *     und fragte danach `GET /sets/exists`. Sichtbar war davon nur eine
 *     Schnellmeldung, die von selbst wieder verschwindet.
 *   • `useScannedSetNumber()` (Texterkennung) zeigte GAR NICHTS an.
 *   • Der Galerie-Weg `addSet()` schloss seinen Dialog sofort und wartete
 *     stumm auf die Antwort des Servers.
 *
 * Wer in dieser Lücke den Scanner erneut öffnet, scannt das nächste Set,
 * während das vorige noch geprüft wird.
 *
 * ── Die Regel, die daraus folgt ─────────────────────────────────────────────
 * PRÜFEN ist sichtbar und hält an. ERFASSEN läuft unsichtbar im Hintergrund.
 *
 * Beides zusammen ist die eigentliche Aussage: Der Anzeige-Dialog steht nur,
 * solange die App noch nicht weiss, ob das Set schon vorhanden ist. Sobald die
 * Antwort da ist, verschwindet er — das Nachladen von Teilen, Anleitungen und
 * Preisen erledigt der Server ohnehin im Hintergrund.
 */
enum class Pruefphase {
    /** EAN → Setnummer. Der lange Teil: bis zu acht Rebrickable-Abrufe. */
    BARCODE,
    /** Steht das Set schon im Blickfeld? */
    BESTAND,
    // ── Die Schritte des Anlegens (Nachtrag 131) ────────────────────────────
    //
    // Bis hierher zeigte die App waehrend des Anlegens nur BESTAND — einen
    // Kringel, bis alles vorbei war. Die Webapp meldet unterdessen, was
    // passiert, und bei einem grossen Set dauert das lange genug, um
    // aufzufallen. Dieselben drei Schritte, die der Server ohnehin schickt
    // (routes/sets.ts → add-stream).
    /** Stammdaten holen — Name, Teilezahl, Jahr. */
    ANLEGEN_STAMMDATEN,
    /** Bild herunterladen. */
    ANLEGEN_BILD,
    /** Stammdaten und Bild sind durch, es fehlt das Aufraeumen. */
    ANLEGEN_ABSCHLUSS,
}

/**
 * @param bezeichner Was gerade geprüft wird — die EAN oder die Setnummer. Ohne
 *   sie sagt der Dialog beim schnellen Scannen nicht, WELCHES Set gemeint ist.
 */
data class Pruefschritt(
    val bezeichner: String,
    val phase: Pruefphase,
)

/**
 * Eigener Fluss statt eines Feldes in `BarcodeUiState` oder `AppUiState`.
 *
 * Die Prüfung gehört zu KEINEM der beiden: Sie läuft im Barcode-Weg, im
 * Texterkennungs-Weg und beim manuellen Erfassen aus Galerie und Katalog. In
 * `BarcodeUiState` wäre sie für die manuellen Wege ein falscher Name; in
 * `AppUiState` ginge jeder Zwischenstand jeden Reiter an — genau der Grund,
 * aus dem die zwölf Barcode-Felder dort herausgelöst wurden (Nachtrag 117).
 */
data class ErfassungUiState(
    val pruefung: Pruefschritt? = null,
)

data class CatalogUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    /**
     * Geladene Seiten, nach Seitennummer.
     *
     * ── Warum eine Karte statt einer Liste (Nachtrag 86) ────────────────────
     * Marcos Vorgabe: Die Zeitleiste rechts soll nicht filtern, sondern
     * schnell scrollen — „kann nicht geprüft werden, wo man hinscrollt, und
     * dieser Teil wird dann geladen".
     *
     * Genau das geht mit einer angehängten Liste nicht: Wer auf Jahr 2005
     * springt, landet mitten im Bestand, und darüber wie darunter fehlt alles.
     * Die Ansicht führt deshalb ALLE `total` Plätze und lädt die Seite, die
     * gerade sichtbar wird — vorwärts wie rückwärts. Was noch nicht da ist,
     * steht als Platzhalter.
     */
    val loadedPages: Map<Int, List<CatalogSetItem>> = emptyMap(),
    val loadingPages: Set<Int> = emptySet(),
    val total: Int = 0,
    /**
     * Sprungziel des Scrubbers — die laufende Nummer, zu der gescrollt werden
     * soll. Die Ansicht führt den Sprung aus und meldet ihn mit
     * catalogScrollConsumed() zurück; ohne das Zurücksetzen liesse sich
     * dasselbe Jahr kein zweites Mal anspringen.
     */
    val scrollTo: Int? = null,
    /**
     * Wo die Liste stand, als man sie verlassen hat.
     *
     * ── Marcos Befund (Nachtrag 91) ─────────────────────────────────────────
     * „Wenn im Katalog eine Detailseite aufgerufen und wieder geschlossen wird,
     * ist der Scrollbalken ganz zuoberst und nicht an der Stelle von vor dem
     * Aufruf."
     *
     * Die Position lag im `LazyGridState` des Bildschirms. Die Detailseite ist
     * ein eigener Navigationspunkt — beim Wechsel verlässt die Liste die
     * Komposition, und was danach wiederhergestellt wird, hängt an Compose'
     * Speichermechanik. Bei einer Liste, deren Länge (`total`) und Inhalt
     * (`loadedPages`) erst nachträglich eintreffen, ist das nicht verlässlich:
     * Wird zum Zeitpunkt der Wiederherstellung noch nichts angezeigt, gibt es
     * keine Stelle, an die zurückgesprungen werden könnte.
     *
     * Im Zustand ist sie unabhängig davon — er lebt im ViewModel und überlebt
     * jeden Wechsel des Bildschirms.
     */
    val scrollIndex: Int = 0,
    val scrollOffset: Int = 0,
    // Filter
    val query: String = "",
    val themeId: Int? = null,
    val year: Int? = null,
    val sort: String = "year_desc",
    // Meta
    val themes: List<CatalogTheme> = emptyList(),
    val yearMin: Int? = null,
    val yearMax: Int? = null,
    /**
     * Wie viele Sets je Jahr, MIT den aktuellen Filtern und in der Reihenfolge
     * der Liste — die Zahlen, aus denen die Leiste rechts ihr Etikett rechnet.
     *
     * Ohne sie stand dort eine lineare Schaetzung (siehe CatalogYearMath): Der
     * Katalog stammt weit ueberwiegend aus den letzten Jahrzehnten, und wer
     * neun Zehntel hinunterzieht, ist deshalb noch lange nicht bei den
     * Sechzigern. Die Webapp rechnet seit Marcos Meldung mit dieser
     * Verteilung; hier steht sie aus demselben Grund.
     *
     * Jahrgaenge OHNE Jahr sind schon weggeworfen — genau wie in der Webapp.
     */
    val jahrVerteilung: List<ch.brickinventoryapp.data.model.JahrAnzahl> = emptyList(),
    // `yearCounts` (Anzahl Sets je Jahr) stand hier, wurde aus der
    // Katalog-Metaantwort gefuellt und nirgends angezeigt. Der Wert steht
    // weiterhin in CatalogMetaResponse; wer ein Jahres-Histogramm bauen will,
    // holt ihn von dort. Gefunden von derselben Regel.
    // Detail
    val detail: CatalogSetDetail? = null,
    val detailLoading: Boolean = false,
)

/**
 * Der Detail-Dialog fuer ein Teil / eine Figur AUS EINEM SET.
 *
 * ── Marcos Wunsch ──────────────────────────────────────────────────────────
 * „Auch die automatisch erfassten Teile und Minifiguren sollen einen
 * Detail-Dialog inkl. Zoom haben. Der Marktpreis kann weggelassen werden, die
 * Anzahl soll nicht geaendert werden koennen. Dafuer soll angezeigt werden,
 * welche Sets dieses Teil und Minifigur verwenden — inkl. Link, um den
 * Detail-Dialog des Sets oeffnen zu koennen."
 *
 * ── Warum ein eigener Fluss ────────────────────────────────────────────────
 * Dieselbe Ueberlegung wie bei BarcodeUiState: Ein geoeffneter Dialog erzeugt
 * Zwischenstaende (laedt, da, Fehler), und die gingen als Felder in AppUiState
 * jeden Reiter an. `offen == null` heisst: kein Dialog.
 *
 * EIN Zustand fuer Teile UND Figuren — der Server beantwortet beide Faelle mit
 * derselben Funktion und liefert dieselbe Form. Zwei Zustaende waeren zwei
 * Stellen, an denen dasselbe steht.
 */
data class SetItemUiState(
    /** "part" oder "fig"; null heisst: der Dialog ist zu. */
    val art: String? = null,
    val nummer: String = "",
    val colorId: Int = 0,
    val laedt: Boolean = false,
    val kopf: BestandteilKopf? = null,
    val sets: List<VerwendendesSet> = emptyList(),
    val fehler: String? = null,
) {
    val offen: Boolean get() = art != null
}
