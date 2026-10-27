package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.automirrored.filled.Label
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.Preisalarm
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.util.resolveThumbUrl
import coil3.ImageLoader
import ch.brickinventoryapp.util.fmtDatum
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.*  // Feature-Extensions (saveSettings, setLanguage, …)
import ch.brickinventoryapp.util.passwortZuKurz
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Schrift
import kotlinx.coroutines.launch
import androidx.compose.material.icons.automirrored.filled.ArrowBack

/**
 * Die Unterseiten der Einstellungen.
 *
 * ── Marcos Befund vom 16.10. ────────────────────────────────────────────────
 *
 *   „Die Abstände in der Android-App in den Einstellungen sind teilweise nicht
 *    vorhanden. Die Elemente sind zu nahe an einander. Generell wirkt dieser
 *    Dialog überladen und nicht liebevoll gestaltet. Kannst du dies besser
 *    machen? Evtl. Auch Elemente aus den Einstellungen in eine eigene Sicht
 *    verschieben?"
 *
 * Er hatte recht, und zwar zweifach. Die Einstellungen trugen VIERZEHN Karten
 * untereinander — Gutscheine, Währung, Erfassungs-Zustand, Preisgrundlage,
 * Sprache, Melde-Schalter, Preisalarme, Lagerorte, Haushalt, Konto,
 * CSV-Import, Geräte, Server, Aktualisierung — und jede davon ist für sich ein
 * kleiner Bildschirm. Untereinandergelegt ergeben sie eine Rolle von mehreren
 * Metern, auf der das Seltene (einmal die Währung setzen) genauso viel Platz
 * einnimmt wie das Häufige.
 *
 * Jetzt steht in den Einstellungen eine LISTE, und was dahinter liegt, hat
 * seine eigene Seite mit eigenem Titel und Zurück-Pfeil. Das ist nicht bloss
 * Aufräumen: Eine Seite, die eine Sache zeigt, kann ihr auch Platz geben.
 *
 * ── Warum die Karten UMGEZOGEN und nicht neu gebaut sind ────────────────────
 *
 * Jede der Karten unten steht zeichengleich so da, wie sie in
 * SettingsScreen.kt stand. Sie tragen Jahre von Marcos Nachbesserungen in
 * ihren Kommentaren; sie „bei der Gelegenheit" neu zu schreiben hiesse, diese
 * Entscheidungen noch einmal treffen zu müssen — und diesmal ohne den Anlass
 * zu kennen. Geändert hat sich ihr ORT, nicht ihr Inhalt.
 */

/**
 * Der Rahmen jeder Unterseite.
 *
 * Titel, Zurück-Pfeil, und darunter der Inhalt mit Luft: ein Abstand zwischen
 * den Karten statt der 10 dp, die vorher zwischen vierzehn Karten standen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Unterseite(
    titel: String,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
    inhalt: @Composable ColumnScope.() -> Unit,
) {
    Scaffold(
        // ── Warum die Unterseite ihren eigenen Snackbar-Halter braucht ──────
        //
        // Die Meldungen der App laufen ueber EINEN Fluss (vm.snackbar), und
        // AppNavigation zeigt sie auf dem `snackbarHostState`. Der HALTER
        // dafuer steht aber im Reiter-Geruest — und das ist hier nicht in der
        // Komposition. Ohne diese Zeile gingen „Gutschein gespeichert",
        // „250 CHF" und jede Absage der Guthaben-Abfrage still verloren.
        // GEMESSEN am Aufbau, nicht vermutet: SetDetailScreen und die anderen
        // Detailseiten zeigen gar keine Snackbars, deshalb ist es dort nie
        // aufgefallen.
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(titel, maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = onZurueck) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack,
                             stringResource(R.string.common_back))
                    }
                },
            )
        },
    ) { innen ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(innen)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Abstaende.gross, vertical = Abstaende.gross),
            verticalArrangement = Arrangement.spacedBy(Abstaende.gross),
        ) { inhalt() }
    }
}

/**
 * Gutscheine.
 *
 * Marcos Vorgabe von damals — „möglichst einfach erreichbar" — ist durch den
 * Umzug nicht verletzt, sondern eingelöst: Die Karte stand bisher GANZ OBEN in
 * einer sehr langen Rolle, weil sie im Laden gebraucht wird. Jetzt ist sie der
 * erste Eintrag der Liste und einen Fingertipp entfernt, ohne dass man an ihr
 * vorbeirollen muss, wenn man etwas anderes sucht.
 */
@Composable
fun GutscheineUnterseite(
    vm: MainViewModel,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
) {
    // `gutscheinZustand` und nicht `zustand`: UiStateFieldsTest bestimmt den
    // Typ eines Namens je DATEI, und in dieser steht weiter unten
    // GeraeteCard(zustand: GeraeteUiState). Mit dem kurzen Namen hielt die
    // Pruefung jedes `zustand.geraete` dort fuer einen Feldzugriff auf
    // GutscheinUiState und meldete fuenf Felder, die es „nicht gibt".
    // GEMESSEN, nicht vermutet: genau daran war der erste CI-Lauf dieses
    // Umbaus rot (534 Tests, einer rot).
    val gutscheinZustand by vm.gutscheinState.collectAsStateWithLifecycle()
    // Die Zwischenablage kommt aus Compose und nicht aus dem ViewModel: Sie
    // ist an die Komposition gebunden. Die Rueckmeldung laeuft ueber den
    // Snackbar des ViewModels, damit sie dort steht, wo alle anderen Meldungen
    // stehen.
    val zwischenablage = androidx.compose.ui.platform.LocalClipboardManager.current
    // Beim Oeffnen DIESER Seite laden und nicht mehr beim Oeffnen der
    // Einstellungen: Wer die Sprache umstellt, braucht keine Gutscheinliste.
    LaunchedEffect(Unit) { vm.ladeGutscheine() }
    Unterseite(stringResource(R.string.vouchers_title), snackbarHostState, onZurueck) {
        GutscheineCard(
            zustand = gutscheinZustand,
            onFeld = { n, p, b, w -> vm.setzeGutscheinFeld(n, p, b, w) },
            onPinSchalten = { vm.schalteGutscheinPin(it) },
            onBearbeiten = { vm.bearbeiteGutschein(it) },
            onAbbrechen = { vm.leereGutscheinFormular() },
            onSpeichern = { vm.speichereGutschein(it) },
            onLoeschen = { vm.loescheGutschein(it) },
            onPdfOeffnen = { vm.oeffneGutscheinPdf(it) },
            onKopieren = { wert, istNummer ->
                zwischenablage.setText(androidx.compose.ui.text.AnnotatedString(wert))
                vm.meldeGutscheinKopiert(istNummer)
            },
            onGuthaben = { vm.frageGuthabenAb(it) },
            onExportieren = { vm.oeffneGutscheinExport() },
            onGuthabenAlle = { vm.frageAlleGuthabenAb() },
            onGuthabenAbbrechen = { vm.guthabenLaufAbbrechen() },
        )
    }
}

/**
 * Preisalarme — die Uebersicht UND der Melde-Schalter.
 *
 * Die beiden standen als zwei Karten untereinander und hiessen „Preisalarm"
 * und „🔔 Preisalarme". Auf einem Bildschirmfoto sind das zwei Rubriken mit
 * praktisch demselben Namen; hier ist es eine Seite mit zwei Abschnitten, und
 * der Schalter steht dort, wo man ihn sucht: bei den Alarmen.
 */
@Composable
fun PreisalarmeUnterseite(
    vm: MainViewModel,
    imageLoader: ImageLoader,
    serverUrl: String,
    snackbarHostState: SnackbarHostState,
    onSetClick: (String) -> Unit,
    onZurueck: () -> Unit,
) {
    Unterseite(stringResource(R.string.alerts_group), snackbarHostState, onZurueck) {
        PreisalarmCard(vm)
        PreisalarmeCard(vm, imageLoader, serverUrl, onSetClick)
    }
}

/** Lagerorte. */
@Composable
fun LagerorteUnterseite(
    vm: MainViewModel,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
) {
    Unterseite(stringResource(R.string.storage_manage), snackbarHostState, onZurueck) {
        LagerorteCard(vm)
    }
}

/** Haushalt — Konten verknuepfen. */
@Composable
fun HaushaltUnterseite(
    vm: MainViewModel,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
) {
    val haushalt by vm.householdState.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.loadHouseholdStatus() }
    Unterseite(stringResource(R.string.household_title), snackbarHostState, onZurueck) {
        HouseholdCard(
            state = haushalt,
            onCreateInvite = { vm.createHouseholdInvite() },
            onRedeemInvite = { code -> vm.redeemHouseholdInvite(code) },
            onUnlink = { id -> vm.unlinkHousehold(id) },
        )
    }
}

/** Konto und angemeldete Geraete — beides betrifft den Zugang. */
@Composable
fun KontoUnterseite(
    vm: MainViewModel,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
) {
    val kontoZustand by vm.kontoState.collectAsStateWithLifecycle()
    val geraeteZustand by vm.geraeteState.collectAsStateWithLifecycle()
    val zfZustand by vm.zweiterFaktorState.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.ladeProfil() }
    LaunchedEffect(Unit) { vm.ladeGeraete() }
    LaunchedEffect(Unit) { vm.ladeZweitenFaktor() }
    Unterseite(stringResource(R.string.konto_title), snackbarHostState, onZurueck) {
        KontoCard(
            kontoZustand = kontoZustand,
            onSpeichern = { b, e, v, n, p -> vm.speichereProfil(b, e, v, n, p) },
            onPasswort = { alt, neu -> vm.aenderePasswort(alt, neu) },
            onMeldungWeg = { vm.kontoMeldungWeg() },
        )
        ZweiterFaktorCard(
            zfZustand = zfZustand,
            onEinrichten = { vm.richteZweitenFaktorEin(it) },
            onBestaetigen = { vm.bestaetigeZweitenFaktor(it) },
            onNeueCodes = { vm.erneuereZweiterFaktorCodes(it) },
            onAbschalten = { pw, code -> vm.schalteZweitenFaktorAb(pw, code) },
            onZurueck = { vm.zweiterFaktorZurueck() },
        )
        GeraeteCard(
            zustand = geraeteZustand,
            onReload = { vm.ladeGeraete() },
            onRevoke = { vm.entwerteGeraet(it) },
            onRevokeOthers = { vm.entwerteAndereGeraete() },
        )
    }
}

/** CSV importieren. */
@Composable
fun CsvImportUnterseite(
    vm: MainViewModel,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
) {
    val csvZustand by vm.csvHochladenState.collectAsStateWithLifecycle()
    Unterseite(stringResource(R.string.csv_upload_title), snackbarHostState, onZurueck) {
        CsvImportCard(
            csvZustand = csvZustand,
            onDatei = { art, uri -> vm.ladeCsvHoch(art, uri) },
            onSchliessen = { vm.csvHochladenWeg() },
        )
    }
}




/**
 * Die eigenen Lagerorte verwalten.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 * „Die Werte sollen pro User verwaltet werden koennen und sollen in den
 * Einstellungen bearbeitbar sein."
 *
 * ── Warum hier nur die EIGENEN stehen ───────────────────────────────────────
 *
 * Ein Lagerort ist ein Regal in der eigenen Wohnung. Beim Set des Enkels
 * waehlt der Grossvater aus dessen Liste — aber fremde Regale UMZUBENENNEN
 * ist keine Einstellung, sondern ein Versehen. Lesen weit, Schreiben eng,
 * dieselbe Trennung wie ueberall im Baum.
 *
 * ── Warum Loeschen nur bei einem leeren Ort geht ────────────────────────────
 *
 * Der Server sagt Nein, solange etwas darin liegt (lagerort_in_benutzung).
 * Die Alternative — stilles Leeren — verloere die Zuordnung von Sets, die der
 * Loeschende gar nicht im Blick hatte, und zwar ohne Weg zurueck.
 */
/**
 * Alle Preisalarme — aendern und loeschen.
 *
 * ── Marcos Frage vom 25.09. ──────────────────────────────────────
 *
 *   „Wie finde ich alle Preisalarme?"
 *
 * Gar nicht, war die Antwort: Ein Alarm war nur im Detail SEINES Sets zu
 * sehen. Wer fuenfzig setzt, hatte keinen Ort, an dem sie zusammen stehen, und
 * keinen, an dem er sieht, welche noch scharf sind.
 *
 * ── Dieselbe Rubrik wie in der Webapp ──────────────────────────────
 *
 * Gleiche Reihenfolge (vor den Lagerorten), gleiche Zeile: Setnummer und Name,
 * Zustand daneben — derselbe Set kann zwei Alarme haben, und die Zeilen
 * unterschieden sich sonst nur an einem Buchstaben. Der letzte Preis steht
 * dabei, weil eine Schwelle ohne ihn nicht zu beurteilen ist: „unter 30"
 * heisst etwas anderes bei einem Set, das bei 28 steht, als bei einem, das bei
 * 300 steht.
 *
 * Gespeichert wird beim Knopf und nicht beim Tippen — anders als das
 * Wunsch-Detail (Nachtrag 133), weil hier jeder Tastendruck sonst eine
 * Schreibanfrage ausloeste, waehrend man die Zahl noch eintippt.
 *
 * ── Marcos Nachtrag vom 26.09. ─────────────────────────────────────
 *
 * Vier Dinge, alle aus einer Sitzung vor der App:
 *
 *  1. „Beim Loeschen soll noch nachgefragt werden." Die Webapp fragt seit
 *     jeher (`confirm`), die App loeschte sofort. Ein Alarm ist schnell
 *     angetippt und nicht wiederherstellbar.
 *  2. Ein Vorschaubild je Zeile, wie in den Finanzen — deshalb auch
 *     dasselbe [FinanzBild] und nicht ein zweites, das anders beschnitten
 *     ist.
 *  3. Die Zeile oeffnet die Detailansicht des Sets. Anklickbar ist sie nur,
 *     wenn das Set in der Sammlung liegt: Ein Alarm ueberlebt das Entfernen
 *     des Sets, und der Klick landete sonst auf einer Adresse, die es nicht
 *     gibt.
 *  4. „Das ‚scharf' analog der Webapp mit einem Label anzeigen." Der gruene
 *     Haken, den Marco dafuer hielt, war der SPEICHERN-Knopf — er stand
 *     dauerhaft gruen neben dem Zahlenfeld und sah aus wie eine Zusage. Er
 *     wird jetzt erst sichtbar, wenn der Wert wirklich geaendert wurde, und
 *     der Zustand steht als Plakette da, wie in der Webapp.
 */
@Composable
private fun PreisalarmeCard(
    vm: MainViewModel,
    imageLoader: ImageLoader,
    serverUrl: String,
    onSetClick: (String) -> Unit,
) {
    val uebersicht by vm.alarmUebersicht.collectAsStateWithLifecycle()
    // Die Rueckfrage haelt die ZEILE fest, nicht nur ein Ja/Nein: Der Text
    // nennt das Set, und beim Bestaetigen braucht es beide Teile des
    // Schluessels (Set und Zustand).
    var fragtLoeschen by remember { mutableStateOf<Preisalarm?>(null) }

    LaunchedEffect(Unit) { vm.ladeAlarmUebersicht() }

    SettingsCard(
        title = stringResource(R.string.alerts_group),
        icon = Icons.Default.NotificationsActive,
    ) {
        Text(stringResource(R.string.alerts_intro),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = Abstaende.klein))

        // `geladen` und nicht nur „Liste leer": Beim Aufbau stuende sonst kurz
        // „keine Alarme gesetzt", obwohl noch gar nichts abgerufen wurde.
        if (uebersicht.geladen && uebersicht.alarme.isEmpty()) {
            Text(stringResource(R.string.alerts_empty),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (a in uebersicht.alarme) {
            // Schluessel ist (Set, Zustand) — beides, sonst traegt das Feld des
            // einen Alarms den Wert des anderen, wenn ein Set beide hat.
            var wert by rememberSaveable(a.setNumber + a.condition) {
                mutableStateOf(a.schwelle.toString())
            }
            // Reihenfolge wie in den Finanzen und in der Webapp: heruntergeladene
            // Kopie, eigene Adresse, Katalog. Fuer ein Set, das man nicht besitzt,
            // bleibt nur die letzte — und das ist beim Preisalarm der haeufige Fall.
            val bildUrl = resolveThumbUrl(serverUrl, a.imageLocal, a.imageUrl)
                ?: a.setImgUrl
            // Nur anklickbar, wenn es die Detailansicht ueberhaupt gibt. `Modifier`
            // ohne `clickable` heisst zugleich: kein Wellenschlag beim Tippen, also
            // sieht man dem Eintrag an, dass da nichts kommt.
            val zeile = if (a.besitzt)
                Modifier.fillMaxWidth().clickable { onSetClick(a.setNumber) }
            else Modifier.fillMaxWidth()
            // ── Der Abstand INNERHALB eines Alarms (Marcos Befund vom 16.10.) ──
            //
            //   „Bei den Preisalarm kommt das label scharf noch immer direkt
            //    am Feld an."
            //
            // Stimmt, und der Abstand, den SettingsCard seit dem Umbau
            // zwischen seinen Kindern legt, kann hier nichts ausrichten: Ein
            // Alarm ist EIN Kind — eine Spalte aus Kopfzeile und Zeile mit der
            // Schwelle. Innerhalb davon stand gar nichts, und so klebte die
            // Plakette „scharf" (letztes Stueck der Kopfzeile) unmittelbar auf
            // dem Eingabefeld darunter.
            //
            // Der Abstand gehoert deshalb an BEIDE Spalten: an die aeussere
            // zwischen Kopf und Schwelle, an die innere zwischen Nummer, Name
            // und Plakette. Letzterer ist haarfein — die drei gehoeren
            // zusammen und sollen eine Einheit bleiben, nur keine Masse.
            Column(zeile.padding(vertical = Abstaende.winzig),
                   verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    FinanzBild(bildUrl, imageLoader, a.name)
                    Column(Modifier.weight(1f),
                           verticalArrangement = Arrangement.spacedBy(Abstaende.haar)) {
                        // Erst benennen, dann setzen: Eine Zeichenkette mit
                        // mehrzeiliger Interpolation ist gueltig und trotzdem
                        // die Zeile, die beim naechsten Anfassen kippt.
                        val zustand = if (a.condition == "U")
                            stringResource(R.string.condition_used)
                        else stringResource(R.string.condition_new)
                        Text("${a.setNumber}  $zustand",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold)
                        a.name?.let {
                            Text(it, style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                            AlarmZustandPlakette(a.ausgeloest)
                            a.zuletztPreis?.let {
                                Text(stringResource(R.string.alerts_last,
                                        "${a.currencyCode} ${"%.2f".format(it)}"),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    IconButton(onClick = { fragtLoeschen = a }) {
                        Icon(Icons.Default.Delete, stringResource(R.string.alerts_delete),
                            tint = MaterialTheme.colorScheme.error)
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    Text(if (a.richtung == "unter") stringResource(R.string.alerts_below)
                         else stringResource(R.string.alerts_above),
                        style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(
                        value = wert,
                        // Der Filter fehlte hier, die Zahlentastatur stand schon
                        // da. Das ist die gefaehrlichere Haelfte: Die
                        // Tastaturwahl ist eine Bitte, keine Zusicherung —
                        // angestoepselte Tastatur und Zwischenablage liefern
                        // trotzdem Buchstaben, und unten wurde daraus eine 0.
                        onValueChange = { wert = NumericInput.price(it) },
                        singleLine = true,
                        suffix = { Text(a.currencyCode) },
                        keyboardOptions = NumericInput.preisTastatur(),
                        modifier = Modifier.weight(1f),
                    )
                    // Der Knopf erscheint erst, wenn wirklich etwas anderes im
                    // Feld steht — vorher stand hier ein dauerhaft gruener Haken,
                    // und der las sich wie eine Zustandsanzeige („scharf") statt
                    // wie ein Knopf. Verglichen wird die ZAHL und nicht der Text:
                    // „30" und „30.0" sind dasselbe.
                    //
                    // Steht KEINE Zahl im Feld, erscheint der Knopf gar nicht
                    // mehr. Vorher hiess „nicht lesbar" hier `?: true`, also
                    // Knopf da — und ein Druck darauf schrieb ueber `?: 0.0`
                    // eine Schwelle von 0. Die ist keine Schwelle: „unter 0"
                    // meldet nie, „ueber 0" meldet immer. Beides faellt erst
                    // Wochen spaeter auf.
                    val zahl = wert.replace(',', '.').toDoubleOrNull()
                    if (zahl != null && zahl != a.schwelle) {
                        IconButton(onClick = {
                            vm.aendereAlarmSchwelle(a.setNumber, a.condition, a.richtung, zahl)
                        }) {
                            Icon(Icons.Default.Save, stringResource(R.string.settings_save),
                                tint = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            }
        }
    }

    // Rueckfrage vor dem Loeschen — wie in der Webapp. Ein Alarm ist mit einem
    // Fingertipp weg und kommt nicht wieder; die Schwelle muesste man neu suchen.
    fragtLoeschen?.let { a ->
        AlertDialog(
            onDismissRequest = { fragtLoeschen = null },
            title = { Text(stringResource(R.string.alerts_delete)) },
            text = { Text(stringResource(R.string.alerts_confirm_delete, a.setNumber)) },
            confirmButton = {
                TextButton(onClick = {
                    fragtLoeschen = null
                    vm.loescheAlarm(a.setNumber, a.condition)
                }) {
                    Text(stringResource(R.string.common_delete),
                         color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { fragtLoeschen = null }) {
                    Text(stringResource(R.string.common_cancel))
                }
            },
        )
    }
}

/**
 * „scharf" oder „unscharf" — ein Label, das ohne Farbe auskommt.
 *
 * ── Marcos Befund vom 26.09. ───────────────────────────────────────────────
 *
 *   „Ok entschuldige ich habe eine rot grün schwäche. Deshalb sind labels mit
 *    scharf / unscharf für mich einfacher."
 *
 * Bis hierher trugen BEIDE Oberflaechen die Aussage in der Farbe: gruen heisst
 * scharf, grau heisst nicht mehr scharf. Fuer rund acht Prozent der Maenner
 * ist das keine Aussage, sondern zweimal dasselbe. Und der Entschuldigung
 * widerspricht die Sache: Nicht das Auge ist der Fehler, sondern eine
 * Oberflaeche, die eine Information NUR in die Farbe legt.
 *
 * Drei Unterschiede tragen sie jetzt, von denen jeder EINZELN reicht:
 *
 *   1. Das WORT. „scharf" und „unscharf" sind ein Paar — vorher stand dort
 *      „scharf" gegen „hat gemeldet", zwei Saetze ueber verschiedene Dinge.
 *      Was „unscharf" bedeutet, sagt der Einleitungstext der Rubrik, und die
 *      Zeile „zuletzt CHF 28.50" daneben steht ohnehin nur bei einem Alarm,
 *      der gemeldet hat (preisalarm.ts setzt beides in derselben Anweisung).
 *   2. Die FORM: gefuellt gegen umrandet.
 *   3. Das ZEICHEN davor: ● gegen ○, gefuellt gegen hohl.
 *
 * Farbe bleibt, aber nur noch als Zugabe — und ausdruecklich NICHT gruen
 * gegen rot. Das Label nimmt `secondaryContainer`, also die Farbfamilie, die
 * jedes der fuenf Designs fuer „hervorgehoben, aber nicht dringend" mitbringt.
 * Ein gruenes Label waere derselbe Fehler noch einmal, nur freundlicher
 * gemeint.
 */
@Composable
private fun AlarmZustandPlakette(ausgeloest: Boolean) {
    val text = stringResource(if (ausgeloest) R.string.alerts_fired else R.string.alerts_armed)
    // Gefuellt = scharf, umrandet = unscharf. Die Flaeche ist der Unterschied,
    // den man auch dann sieht, wenn die beiden Farben gleich aussehen.
    Surface(
        shape = Formen.chip,
        color = if (ausgeloest) Color.Transparent
                else MaterialTheme.colorScheme.secondaryContainer,
        border = if (ausgeloest)
            BorderStroke(1.dp, MaterialTheme.colorScheme.outline) else null,
    ) {
        Text(
            text,
            style = MaterialTheme.typography.labelSmall,
            // Auch das Gewicht traegt mit: Ein scharfer Alarm ist der Zustand,
            // auf den es ankommt.
            fontWeight = if (ausgeloest) FontWeight.Normal else FontWeight.SemiBold,
            color = if (ausgeloest) MaterialTheme.colorScheme.onSurfaceVariant
                    else MaterialTheme.colorScheme.onSecondaryContainer,
            modifier = Modifier.padding(
                horizontal = Abstaende.winzig, vertical = Abstaende.haar),
        )
    }
}


@Composable
private fun LagerorteCard(vm: MainViewModel) {
    val lager by vm.lagerState.collectAsStateWithLifecycle()
    var neuerOrt by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(Unit) { vm.ladeEigeneLagerorte() }

    SettingsCard(
        title = stringResource(R.string.storage_manage),
        icon = Icons.Default.Inventory2,
    ) {
        Text(stringResource(R.string.storage_manage_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = Abstaende.haar))
        // ── Marcos Stern ────────────────────────────────────────────────────
        //
        // „Weiter moechte ich ein Lagerort in den Einstellungen als Default
        //  setzen koennen. Der soll dann bei einer Neuerfassung bereits
        //  vorausgewaehlt sein. Ich stelle mir das mit einem Sternicon vor."
        //
        // Der Hinweis steht da, weil ein Stern allein nicht sagt, WAS er tut —
        // und weil niemand erraten soll, dass ein zweiter Druck ihn abschaltet.
        Text(stringResource(R.string.storage_default_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = Abstaende.klein))

        if (lager.eigene.isEmpty()) {
            Text(stringResource(R.string.storage_empty),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (ort in lager.eigene) {
            // Schluessel ist der Name: Kommt er nach dem Umbenennen anders vom
            // Server zurueck (getrimmt), soll das Feld ihn zeigen.
            var name by rememberSaveable(ort.name) { mutableStateOf(ort.name) }
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { if (it.length <= 60) name = it },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                // ── Der Stern: gefuellt ODER umrissen ───────────────────
                //
                // Der Unterschied liegt in der FORM und nicht in der Farbe.
                // Marco ist rot-gruen-schwach; ein farbig hervorgehobener
                // Eintrag waere fuer ihn kein Unterschied. Die Beschreibung
                // sagt dasselbe noch einmal in Worten — fuer die
                // Sprachausgabe und fuer jeden, der den Stern nicht deutet.
                val istVorgabe = lager.vorgabe?.id == ort.id
                IconButton(onClick = { vm.schalteLagerortVorgabe(ort.id, istVorgabe) }) {
                    Icon(
                        if (istVorgabe) Icons.Default.Star else Icons.Default.StarBorder,
                        stringResource(if (istVorgabe) R.string.storage_default_is
                                       else R.string.storage_default_set),
                    )
                }
                // Umbenennen auf Knopfdruck, NICHT beim Tippen: Anders als beim
                // Lagerort am Set schreibt ein Umbenennen hier alle Zuordnungen
                // mit um. Das nebenbei zu tun, waehrend jemand einen Buchstaben
                // aendert, waere zu viel Wirkung fuer zu wenig Geste.
                IconButton(
                    onClick = { vm.benenneLagerortUm(ort.id, name) },
                    enabled = name.isNotBlank() && name != ort.name,
                ) { Icon(Icons.Default.Save, stringResource(R.string.settings_save)) }
                IconButton(
                    onClick = { vm.loescheLagerort(ort.id) },
                ) { Icon(Icons.Default.Delete, stringResource(R.string.storage_delete)) }
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            modifier = Modifier.fillMaxWidth().padding(top = Abstaende.klein)) {
            OutlinedTextField(
                value = neuerOrt,
                onValueChange = { if (it.length <= 60) neuerOrt = it },
                singleLine = true,
                placeholder = { Text(stringResource(R.string.storage_new), fontSize = Schrift.klein) },
                modifier = Modifier.weight(1f),
            )
            Button(
                onClick = { val n = neuerOrt.trim(); neuerOrt = ""; vm.legeLagerortAn(n) },
                enabled = neuerOrt.isNotBlank(),
                shape = Formen.knopf,
            ) { Text(stringResource(R.string.storage_add), fontSize = Schrift.klein) }
        }
    }
}

/**
 * Der Schalter fuer die Preisalarm-Meldungen auf DIESEM Geraet.
 *
 * ── Warum er nicht im Konto steht ───────────────────────────────────────────
 *
 * Der Server verschickt bei jedem gerissenen Alarm eine E-Mail — das ist die
 * kontobezogene Haelfte. Diese hier ist die geraetebezogene: Wer dasselbe
 * Konto am Telefon und am Tablet benutzt, will die Meldung in aller Regel nur
 * an einem der beiden. Genau dieselbe Ueberlegung wie beim Vorwaermen und beim
 * Kontofilter.
 *
 * ── Warum die Berechtigung erst hier erfragt wird ───────────────────────────
 *
 * Ab Android 13 ist POST_NOTIFICATIONS eine Laufzeitberechtigung. Sie gleich
 * beim ersten Start zu erfragen waere die uebliche und die schlechtere
 * Loesung: Die Frage kaeme, bevor irgendetwas sie erklaert, und ein Nein ist
 * danach nur noch ueber die Systemeinstellungen zu widerrufen. Hier steht
 * unmittelbar daneben, wofuer sie ist.
 *
 * Der Schalter wird auch dann umgelegt, wenn die Erlaubnis verweigert wird.
 * Das ist Absicht: Die Einstellung sagt „ich will das", die Berechtigung sagt
 * „das System laesst es zu" — zwei verschiedene Dinge. Wer die Erlaubnis
 * spaeter in den Systemeinstellungen nachreicht, bekommt seine Meldungen, ohne
 * hier noch einmal etwas tun zu muessen.
 */
@Composable
private fun PreisalarmCard(vm: MainViewModel) {
    val context = androidx.compose.ui.platform.LocalContext.current
    // Siehe AcquisitionManagementScreen: LocalResources statt Context, weil
    // Lint LocalContextGetResourceValueCall als ERROR meldet und der
    // Platzhalter erst aus der Ausnahme entsteht.
    val resn = androidx.compose.ui.platform.LocalResources.current
    val bereich = rememberCoroutineScope()
    // Direkt aus den Einstellungen, nicht ueber AppUiState: eine
    // Geraete-Einstellung, genau wie die drei Netzerlaubnisse in
    // MonitoringSections. Ein weiteres Feld im gemeinsamen Zustand waere nur
    // eine zweite Fassung derselben Wahrheit.
    val an by vm.prefs.alarmMeldungenAn.collectAsStateWithLifecycle(initialValue = false)

    val frage = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission()
    ) { /* Antwort egal — Begruendung im Kommentar ueber dieser Funktion. */ }

    SettingsCard(
        title = stringResource(R.string.detail_alert),
        icon = Icons.Default.Notifications,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.alert_notify), fontSize = Schrift.normal)
                Text(stringResource(R.string.alert_notify_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Switch(
                checked = an,
                onCheckedChange = { neu ->
                    // Die Berechtigung ZUERST und auf dem Hauptthread: Sie
                    // oeffnet einen Systemdialog, und der gehoert nicht hinter
                    // eine Hintergrundarbeit.
                    if (neu && android.os.Build.VERSION.SDK_INT >= 33) {
                        frage.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                    }
                    bereich.launch {
                        vm.prefs.setzeAlarmMeldungen(neu)
                        // ── Nicht auf dem Hauptthread ────────────────────────
                        //
                        // Der Auftrag folgt dem Schalter sofort und nicht erst
                        // beim naechsten App-Start: Sonst waere „eingeschaltet"
                        // eine Stunde lang eine Behauptung ohne Wirkung.
                        //
                        // Aber nicht hier vorne: Beim ERSTEN Zugriff faehrt
                        // WorkManager hoch und liest dabei von der Platte
                        // (der Manifest-Eintrag erklaert, warum das nicht mehr
                        // beim App-Start geschieht). Auf dem Hauptthread einer
                        // sichtbaren Oberflaeche ist das im besten Fall ein
                        // Ruckeln.
                        //
                        // Marcos Befund vom 25.09.: „Sobald ich den Schalter
                        // Preisalarm in der App aktivieren will, wird die App
                        // geschlossen." Dieser Aufruf stand hier ungesichert,
                        // waehrend derselbe Aufruf beim App-Start seit jeher in
                        // einem runCatching steckt. einplanen() faengt jetzt
                        // selbst und GIBT DEN FEHLER ZURUECK — verschluckt wird
                        // er nicht: Ein Schalter auf „an", von dem nie eine
                        // Meldung kommt, ist die zweite Haelfte desselben
                        // Fehlers.
                        val fehler = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                            ch.brickinventoryapp.alarm.PreisalarmWorker.einplanen(context, neu)
                        }
                        if (fehler != null) {
                            // Klasse UND Meldung: Am 25.09. reichte die
                            // Meldung allein („WorkDatabase_Impl.<init> []"),
                            // aber erst der Klassenname sagt, dass es eine
                            // NoSuchMethodException ist — und damit, ob etwas
                            // fehlt oder etwas schiefging. Die naechste
                            // Ursache ist vielleicht weniger gespraechig.
                            vm.showSnackbar(resn.getString(
                                R.string.alert_schedule_failed,
                                "${fehler::class.java.simpleName}: ${fehler.message ?: "—"}"))
                        }
                    }
                },
            )
        }
    }
}

/**
 * Angemeldete Geräte: die ausgestellten Zugänge sehen und aussperren.
 *
 * ── Warum der eigene Zugang keinen Knopf hat ────────────────────────────────
 * Der Server markiert die Zeile, mit der GERADE gefragt wird. Wer sie
 * entwertet, meldet sich selbst ab — ohne dass ein Mülleimer-Symbol das sagt.
 * Für „dieses Gerät abmelden" gibt es den Abmelden-Knopf am Ende der Seite;
 * er benennt, was er tut.
 *
 * ── Datumsangaben über fmtDatum(), nicht selbst gebaut ─────────────────────
 * Der Server liefert ISO-Zeitstempel. `iso.take(10)` wäre die dritte Fassung
 * derselben Umwandlung im Baum gewesen; die ersten beiden sind in
 * util/DatumFormat.kt zusammengelegt worden, weil eine davon bei Zeitstempeln
 * OHNE Millisekunden still null ergab (siehe DatumFormatTest). Genau solche
 * Zeitstempel liefert api_tokens.
 *
 * „Nie benutzt" bekommt einen eigenen Text statt eines leeren Feldes —
 * `new Date(null)` wäre der 1.1.1970, und ein leeres Feld sieht aus wie ein
 * Fehler.
 */
@Composable
private fun GeraeteCard(
    zustand: ch.brickinventoryapp.ui.GeraeteUiState,
    onReload: () -> Unit,
    onRevoke: (String) -> Unit,
    onRevokeOthers: () -> Unit,
) {
    var fragt by rememberSaveable { mutableStateOf<String?>(null) }
    var fragtAlle by rememberSaveable { mutableStateOf(false) }

    SettingsCard(title = stringResource(R.string.tokens_title), icon = Icons.Default.Devices) {
        Text(stringResource(R.string.tokens_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = Abstaende.mittel))

        when {
            zustand.laedt && zustand.geraete.isEmpty() ->
                CircularProgressIndicator(Modifier.size(22.dp))
            zustand.fehler != null ->
                Text(zustand.fehler, color = MaterialTheme.colorScheme.error,
                     style = MaterialTheme.typography.bodySmall)
            zustand.geraete.isEmpty() ->
                Text(stringResource(R.string.tokens_none),
                     style = MaterialTheme.typography.bodySmall,
                     color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> Column(verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                for (g in zustand.geraete) {
                    Row(verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(g.label ?: "—", fontWeight = FontWeight.SemiBold)
                                if (g.aktuell) Surface(
                                    shape = Formen.chip,
                                    color = MaterialTheme.colorScheme.primaryContainer,
                                ) {
                                    Text(stringResource(R.string.tokens_current),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                                        modifier = Modifier.padding(horizontal = 6.dp, vertical = Abstaende.haar))
                                }
                            }
                            Text(
                                stringResource(R.string.tokens_row_hint,
                                    fmtDatum(g.createdAt) ?: "—",
                                    fmtDatum(g.lastUsed) ?: stringResource(R.string.tokens_unused),
                                    if (g.neverExpires) stringResource(R.string.tokens_never) else (fmtDatum(g.expiresAt) ?: "—")),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (!g.aktuell) IconButton(onClick = { fragt = g.tokenId }) {
                            Icon(Icons.Default.Delete,
                                stringResource(R.string.tokens_revoke_title),
                                tint = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
        }

        Row(Modifier.padding(top = Abstaende.mittel), horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            OutlinedButton(onClick = onReload, shape = Formen.knopf) {
                Text(stringResource(R.string.tokens_reload))
            }
            // Nur anbieten, wenn es wirklich andere gibt — ein Knopf, der
            // immer „es gibt keine anderen" meldet, ist schlimmer als keiner.
            if (zustand.geraete.count { !it.aktuell } > 0) {
                OutlinedButton(
                    onClick = { fragtAlle = true },
                    shape = Formen.knopf,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text(stringResource(R.string.tokens_revoke_others)) }
            }
        }
    }

    // Rückfrage: Ein Zugang, der weg ist, kommt nicht wieder — das Gerät
    // dahinter muss sich neu anmelden.
    val zuEntwerten = fragt
    if (zuEntwerten != null) AlertDialog(
        onDismissRequest = { fragt = null },
        title = { Text(stringResource(R.string.tokens_revoke_title)) },
        text = { Text(stringResource(R.string.tokens_revoke_text,
            zustand.geraete.firstOrNull { it.tokenId == zuEntwerten }?.label ?: "—")) },
        confirmButton = {
            TextButton(onClick = { fragt = null; onRevoke(zuEntwerten) }) {
                Text(stringResource(R.string.tokens_revoke_confirm),
                     color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = { fragt = null }) { Text(stringResource(R.string.common_cancel)) }
        },
    )

    if (fragtAlle) AlertDialog(
        onDismissRequest = { fragtAlle = false },
        title = { Text(stringResource(R.string.tokens_revoke_others_title)) },
        text = {
            val betroffen = zustand.geraete.count { !it.aktuell }
            Text(pluralStringResource(
                R.plurals.tokens_revoke_others_text, betroffen, betroffen))
        },
        confirmButton = {
            TextButton(onClick = { fragtAlle = false; onRevokeOthers() }) {
                Text(stringResource(R.string.tokens_revoke_confirm),
                     color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = { fragtAlle = false }) { Text(stringResource(R.string.common_cancel)) }
        },
    )
}

/**
 * Haushalts-Karte: verknüpfen, Einladungscode erzeugen, Verknüpfung lösen.
 *
 * Zeigt je nach Rolle nur EINEN der beiden Kästen. Wer schon Unterkonto ist,
 * sieht keinen Einladungsknopf (Konten lassen sich nur über eine Stufe
 * verknüpfen), und wer Unterkonten hat, sieht kein Eingabefeld. Beides würde
 * der Server ohnehin ablehnen — aber ein Knopf, der immer eine Fehlermeldung
 * erzeugt, ist schlimmer als keiner.
 */
@Composable
private fun HouseholdCard(
    state: ch.brickinventoryapp.ui.HouseholdUiState,
    onCreateInvite: () -> Unit,
    onRedeemInvite: (String) -> Unit,
    onUnlink: (Int?) -> Unit,
) {
    val st = state.status
    var code by rememberSaveable { mutableStateOf("") }
    // LocalClipboardManager ist veraltet („Use LocalClipboard instead which
    // supports suspend functions"). Der Nachfolger ist kein reiner
    // Namenstausch: `Clipboard.setClipEntry` ist SUSPEND, braucht also einen
    // Bereich, und der Eintrag wird aus einem ClipData gebaut.
    //
    // GELESEN in der Quelle von androidx (Google-Maven ist aus dieser
    // Umgebung gesperrt, raw.githubusercontent.com nicht):
    //
    //   public val LocalClipboard: ProvidableCompositionLocal<Clipboard>
    //   public suspend fun setClipEntry(clipEntry: ClipEntry?)
    //   public actual class ClipEntry(public val clipData: ClipData)
    val clipboard = androidx.compose.ui.platform.LocalClipboard.current
    val kopierBereich = rememberCoroutineScope()
    // Das Etikett eines ClipData ist auf manchen Android-Oberflaechen SICHTBAR
    // — es gehoert darum in die Sprachdateien und nicht in den Quelltext.
    //
    // Hier stand erst `"invite"`, und StringResourceParityTest hat es zu Recht
    // beanstandet: `newPlainText(` endet auf `Text(` und faellt damit unter
    // dieselbe Regel wie ein Compose-`Text("…")`. Das ist kein Fehlalarm des
    // Tests, sondern genau sein Zweck.
    //
    // Geholt wird die Zeichenkette HIER, nicht im onClick: stringResource ist
    // @Composable, der Klick-Rumpf ist es nicht.
    val einladungEtikett = stringResource(R.string.household_invite_label)

    SettingsCard(title = stringResource(R.string.household_title), icon = Icons.Default.Group) {
        Text(stringResource(R.string.household_intro),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)

        // Kein when-Block mehr, sondern zwei unabhaengige Abschnitte: Seit
        // Konten ueber mehrere Stufen verknuepfbar sind, ist ein
        // Zwischenkonto BEIDES — Kind seines Elternkontos und Elternteil
        // seiner eigenen Unterkonten. Die frueheren Zweige schlossen sich
        // gegenseitig aus und zeigten ihm nur die obere Haelfte.
        if (st != null && st.isSub) {
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                Text(stringResource(R.string.household_state_sub, st.linkedTo?.username ?: ""),
                    style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                TextButton(onClick = { onUnlink(null) }) {
                    Text(stringResource(R.string.household_unlink))
                }
            }
        }
        if (st != null && st.subAccounts.isNotEmpty()) {
            // Nur die DIREKTEN Unterkonten — nur deren Verknuepfung haengt am
            // eigenen Konto und laesst sich von hier loesen. Das ganze
            // Blickfeld zeigt der Kontofilter.
            Text(stringResource(R.string.household_state_main),
                style = MaterialTheme.typography.labelLarge)
            st.subAccounts.forEach { m ->
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    Text(m.username, modifier = Modifier.weight(1f),
                        fontWeight = FontWeight.SemiBold)
                    TextButton(onClick = { onUnlink(m.id) }) {
                        Text(stringResource(R.string.household_remove))
                    }
                }
            }
        }
        if (st != null && !st.isSub && st.subAccounts.isEmpty()) {
            Text(stringResource(R.string.household_state_none),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        // Einladen darf JEDES Konto — auch eines, das selbst Unterkonto ist.
        if (st != null) {
            HorizontalDivider()
            Text(stringResource(R.string.household_invite_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(onClick = onCreateInvite, enabled = !state.isLoading) {
                Text(stringResource(R.string.household_invite_create))
            }
            state.inviteCode?.let { c ->
                OutlinedTextField(
                    value = c, onValueChange = {}, readOnly = true, singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = {
                        IconButton(onClick = {
                            kopierBereich.launch {
                                clipboard.setClipEntry(
                                    androidx.compose.ui.platform.ClipEntry(
                                        android.content.ClipData.newPlainText(
                                            einladungEtikett, c)))
                            }
                        }) { Icon(Icons.Default.ContentCopy, stringResource(R.string.household_invite_copy)) }
                    }
                )
            }
        }

        // Einloesen kann, wer noch kein Elternkonto hat: Das Schema laesst
        // hoechstens eines zu (UNIQUE auf sub_user_id). Eigene Unterkonten
        // stehen dem nicht mehr im Weg.
        if (st != null && !st.isSub) {
            HorizontalDivider()
            Text(stringResource(R.string.household_redeem_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(
                value = code, onValueChange = { code = it }, singleLine = true,
                label = { Text(stringResource(R.string.household_redeem_title)) },
                modifier = Modifier.fillMaxWidth()
            )
            Button(onClick = { onRedeemInvite(code); code = "" },
                   enabled = code.isNotBlank() && !state.isLoading) {
                Text(stringResource(R.string.household_redeem_submit))
            }
        }

        // Meldung des Servers — Währung weicht ab, Konto schon verknüpft,
        // zweite Stufe. Wortlaut unverändert übernommen.
        state.message?.let {
            Text(it, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }
    }
}

/**
 * Das eigene Konto: Profil und Passwort.
 *
 * ── Warum es das in der App erst jetzt gibt (Nachtrag 127) ──────────────────
 *
 * Nicht, weil der Server es nicht koennte: /auth/profile und
 * /auth/change-password gibt es seit jeher. Sie hingen an einem Waechter, der
 * ausschliesslich die Browser-Sitzung kannte — und die App hat keine, sie
 * weist sich mit einem Bearer-Token aus. Fuenf weitere „fehlende Funktionen"
 * der App hatten dieselbe Ursache.
 */
@Composable
private fun KontoCard(
    // `kontoZustand`, nicht `zustand`: In DIESER Datei ist `zustand` schon
    // vergeben — GeraeteCard nimmt einen Parameter dieses Namens vom Typ
    // GeraeteUiState. Fuer den Compiler ist das unproblematisch (getrennte
    // Gueltigkeitsbereiche), fuer UiStateFieldsTest nicht: Der bestimmt den Typ
    // je Name und DATEI und meldete prompt sechs angeblich fehlende Felder.
    // Dieselbe Falle steht zweimal im Kopf dieser Datei beschrieben — und ich
    // bin trotzdem hineingelaufen.
    kontoZustand: ch.brickinventoryapp.ui.KontoUiState,
    onSpeichern: (String, String, String, String, String?) -> Unit,
    onPasswort: (String, String) -> Unit,
    onMeldungWeg: () -> Unit,
) {
    val profil = kontoZustand.profil
    // Die Felder werden aus dem Serverstand vorbelegt und danach vom Nutzer
    // gefuehrt. `remember(profil)` und nicht `remember`: Nach dem Speichern
    // holt das ViewModel das Profil neu, und die Felder sollen den
    // NORMALISIERTEN Stand des Servers zeigen, nicht das Getippte.
    var benutzername by remember(profil) { mutableStateOf(profil?.username.orEmpty()) }
    var email        by remember(profil) { mutableStateOf(profil?.email.orEmpty()) }
    var vorname      by remember(profil) { mutableStateOf(profil?.firstName.orEmpty()) }
    var nachname     by remember(profil) { mutableStateOf(profil?.lastName.orEmpty()) }
    var pwAktuell    by rememberSaveable { mutableStateOf("") }
    var pwFuerEmail  by remember(profil) { mutableStateOf("") }
    var pwNeu        by rememberSaveable { mutableStateOf("") }

    val emailNeu = profil != null && !email.trim().equals(profil.email.orEmpty(), ignoreCase = true)
    val geaendert = profil != null && (
        benutzername != profil.username.orEmpty() || email != profil.email.orEmpty() ||
        vorname != profil.firstName.orEmpty() || nachname != profil.lastName.orEmpty())

    SettingsCard(title = stringResource(R.string.konto_title), icon = Icons.Default.AccountCircle) {
        if (kontoZustand.laedt && profil == null) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
        }

        if (kontoZustand.meldung != null) {
            Text(kontoZustand.meldung, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary)
        }
        if (kontoZustand.fehler != null) {
            Text(kontoZustand.fehler, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }

        if (profil != null) {
            val tippen: (String) -> Unit = { onMeldungWeg() }
            OutlinedTextField(
                value = benutzername,
                onValueChange = { benutzername = it; tippen(it) },
                label = { Text(stringResource(R.string.login_username)) },
                modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf)
            OutlinedTextField(
                value = email,
                onValueChange = { email = it; tippen(it) },
                label = { Text(stringResource(R.string.register_email)) },
                // Der Server setzt die Bestaetigung zurueck, wenn die Adresse
                // wechselt. Der Hinweis sagt, WARUM hier plotzlich „nicht
                // bestaetigt" steht, statt es unkommentiert anzuzeigen.
                supportingText = if (profil.emailVerified != 1) {
                    { Text(stringResource(R.string.konto_email_unverified)) }
                } else null,
                isError = profil.emailVerified != 1,
                modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                OutlinedTextField(
                    value = vorname, onValueChange = { vorname = it; tippen(it) },
                    label = { Text(stringResource(R.string.register_first_name)) },
                    modifier = Modifier.weight(1f), singleLine = true, shape = Formen.knopf)
                OutlinedTextField(
                    value = nachname, onValueChange = { nachname = it; tippen(it) },
                    label = { Text(stringResource(R.string.register_last_name)) },
                    modifier = Modifier.weight(1f), singleLine = true, shape = Formen.knopf)
            }
            // Über eine neue Adresse liesse sich das Passwort zurücksetzen —
            // darum fragt der Server dann nach dem aktuellen.
            if (emailNeu) {
                OutlinedTextField(
                    value = pwFuerEmail, onValueChange = { pwFuerEmail = it; tippen(it) },
                    label = { Text(stringResource(R.string.konto_email_password)) },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf)
            }
            Button(
                onClick = { onSpeichern(benutzername, email, vorname, nachname, pwFuerEmail.takeIf { emailNeu }) },
                enabled = geaendert && !kontoZustand.speichert && (!emailNeu || pwFuerEmail.isNotEmpty()),
                modifier = Modifier.fillMaxWidth().height(44.dp), shape = Formen.knopf
            ) { Text(stringResource(R.string.konto_save), fontWeight = FontWeight.SemiBold) }

            HorizontalDivider(Modifier.padding(vertical = Abstaende.mittel),
                color = MaterialTheme.colorScheme.outlineVariant)

            Text(stringResource(R.string.konto_password_title),
                style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
            // Steht VOR den Feldern, nicht darunter: Wer erst nach dem Tippen
            // erfaehrt, dass er sich damit abmeldet, hat schon getippt.
            Text(stringResource(R.string.konto_password_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(
                value = pwAktuell, onValueChange = { pwAktuell = it },
                label = { Text(stringResource(R.string.konto_password_current)) },
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
            OutlinedTextField(
                value = pwNeu, onValueChange = { pwNeu = it },
                label = { Text(stringResource(R.string.konto_password_new)) },
                visualTransformation = PasswordVisualTransformation(),
                // Dieselbe Mindestlaenge wie im Server (PASSWORT_MIN_ZEICHEN in
                // utils/auth.ts) und in der Webapp. Hier vorweggenommen, damit
                // man dafuer nicht erst eine Runde ueber das Netz braucht.
                //
                // Die Zahl stand in dieser Ansicht dreimal und im
                // Registrierformular ein viertes Mal — jetzt in util/Passwort.kt.
                supportingText = if (pwNeu.isNotEmpty() && passwortZuKurz(pwNeu)) {
                    { Text(stringResource(R.string.register_password_short)) }
                } else null,
                isError = pwNeu.isNotEmpty() && passwortZuKurz(pwNeu),
                modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
            OutlinedButton(
                onClick = { onPasswort(pwAktuell, pwNeu) },
                enabled = !kontoZustand.speichert && pwAktuell.isNotBlank() && !passwortZuKurz(pwNeu),
                modifier = Modifier.fillMaxWidth().height(44.dp), shape = Formen.knopf
            ) { Text(stringResource(R.string.konto_password_button), fontWeight = FontWeight.SemiBold) }
        }
    }
}

/**
 * Zweiter Faktor: einrichten, abschalten, neue Wiederherstellungscodes.
 *
 * Auf dem Telefon braucht es keinen QR-Code: Der otpauth-Link oeffnet die
 * Authenticator-App direkt. Fehlt eine, bleibt der Schluessel zum Kopieren.
 */
@Composable
private fun ZweiterFaktorCard(
    zfZustand: ch.brickinventoryapp.ui.ZweiterFaktorUiState,
    onEinrichten: (String) -> Unit,
    onBestaetigen: (String) -> Unit,
    onNeueCodes: (String) -> Unit,
    onAbschalten: (String, String) -> Unit,
    onZurueck: () -> Unit,
) {
    var zfPasswort by rememberSaveable { mutableStateOf("") }
    var zfCode     by rememberSaveable { mutableStateOf("") }
    var ohneApp    by rememberSaveable { mutableStateOf(false) }
    val uriHandler = androidx.compose.ui.platform.LocalUriHandler.current
    val clipboard = androidx.compose.ui.platform.LocalClipboard.current
    val kopierBereich = rememberCoroutineScope()
    val schluesselEtikett = stringResource(R.string.app_name)
    val kopieren: (String) -> Unit = { text ->
        kopierBereich.launch {
            clipboard.setClipEntry(
                androidx.compose.ui.platform.ClipEntry(
                    android.content.ClipData.newPlainText(schluesselEtikett, text)))
        }
    }
    // Felder leeren, sobald ein Schritt gelungen ist — sonst stuende das
    // Passwort beim naechsten Schritt noch da.
    LaunchedEffect(zfZustand.aktiv, zfZustand.geheimnis, zfZustand.codes) { zfPasswort = ""; zfCode = "" }

    SettingsCard(title = stringResource(R.string.zf_title), icon = Icons.Default.Security) {
        Text(stringResource(R.string.zf_hint), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (zfZustand.laedt) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (zfZustand.fehler != null) {
            Text(zfZustand.fehler, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }

        val passwortFeld: @Composable () -> Unit = {
            OutlinedTextField(
                value = zfPasswort, onValueChange = { zfPasswort = it },
                label = { Text(stringResource(R.string.konto_password_current)) },
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        }
        val codeFeld: @Composable (String) -> Unit = { beschriftung ->
            OutlinedTextField(
                value = zfCode, onValueChange = { zfCode = it.take(12) },
                label = { Text(beschriftung) },
                modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii))
        }

        when {
            // 1. Frische Codes: einmal zeigen, dann wegraeumen.
            zfZustand.codes.isNotEmpty() -> {
                Text(stringResource(R.string.zf_codes_title), fontWeight = FontWeight.SemiBold)
                Text(stringResource(R.string.zf_codes_hint), style = MaterialTheme.typography.bodySmall)
                Text(zfZustand.codes.joinToString("\n"),
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
                Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    OutlinedButton(onClick = { kopieren(zfZustand.codes.joinToString("\n")) },
                        shape = Formen.knopf) { Text(stringResource(R.string.zf_copy)) }
                    Button(onClick = onZurueck, shape = Formen.knopf) { Text(stringResource(R.string.zf_codes_done)) }
                }
            }
            // 2. Einrichtung laeuft: Schluessel in die App, Code bestaetigen.
            zfZustand.geheimnis != null -> {
                Text(stringResource(R.string.zf_step_app), style = MaterialTheme.typography.bodySmall)
                Button(
                    onClick = {
                        val uri = zfZustand.otpauth
                        ohneApp = uri == null || runCatching { uriHandler.openUri(uri) }.isFailure
                    },
                    modifier = Modifier.fillMaxWidth(), shape = Formen.knopf
                ) { Text(stringResource(R.string.zf_open_app)) }
                if (ohneApp) {
                    Text(stringResource(R.string.zf_no_app), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error)
                }
                Text(zfZustand.geheimnis.chunked(4).joinToString(" "),
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
                OutlinedButton(onClick = { kopieren(zfZustand.geheimnis) }, shape = Formen.knopf) {
                    Text(stringResource(R.string.zf_copy_key))
                }
                codeFeld(stringResource(R.string.zf_confirm_code))
                Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    Button(onClick = { onBestaetigen(zfCode) }, enabled = zfCode.isNotBlank() && !zfZustand.laedt,
                        shape = Formen.knopf) { Text(stringResource(R.string.zf_confirm)) }
                    OutlinedButton(onClick = onZurueck, shape = Formen.knopf) { Text(stringResource(R.string.common_cancel)) }
                }
            }
            // 3. Aktiv: neue Codes oder abschalten.
            zfZustand.aktiv == true -> {
                Text(pluralStringResource(R.plurals.zf_active, zfZustand.codesUebrig, zfZustand.codesUebrig),
                    color = MaterialTheme.colorScheme.primary)
                passwortFeld()
                codeFeld(stringResource(R.string.login_code))
                Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    OutlinedButton(onClick = { onNeueCodes(zfCode) }, enabled = zfCode.isNotBlank() && !zfZustand.laedt,
                        shape = Formen.knopf) { Text(stringResource(R.string.zf_new_codes)) }
                    OutlinedButton(onClick = { onAbschalten(zfPasswort, zfCode) },
                        enabled = zfPasswort.isNotBlank() && zfCode.isNotBlank() && !zfZustand.laedt,
                        shape = Formen.knopf) { Text(stringResource(R.string.zf_disable)) }
                }
            }
            // 4. Nicht eingerichtet.
            zfZustand.aktiv == false -> {
                passwortFeld()
                Button(onClick = { onEinrichten(zfPasswort) }, enabled = zfPasswort.isNotBlank() && !zfZustand.laedt,
                    modifier = Modifier.fillMaxWidth().height(44.dp), shape = Formen.knopf
                ) { Text(stringResource(R.string.zf_setup), fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}

/**
 * Eine CSV-Datei hochladen — Sets, Teile, Minifiguren oder die Merkliste.
 *
 * Dieselben Adressen, die die Webapp anbietet. Die App konnte Importe
 * bisher nur beobachten (der Fortschrittsbalken oben in der Galerie); starten
 * konnte sie keinen, weil die Dateiauswahl fehlte und die Routen an einem
 * sitzungsgebundenen Waechter hingen (Nachtrag 127/128).
 *
 * Der Fortschritt DANACH kommt weiterhin ueber den bestehenden Kanal: Der
 * Import laeuft auf dem Server weiter, auch wenn die App zugeklappt wird.
 *
 * ── Warum FlowRow und nicht mehr Row ───────────────────────────────────────
 *
 * Mit der Merkliste sind es VIER Knoepfe. In einer Row mit weight(1f) teilen
 * sie sich die Breite zu gleichen Teilen, und „Minifiguren" passt dann auf
 * einem Telefon nicht mehr hinein — maxLines = 1 schneidet es ab, und was
 * abgeschnitten dasteht, liest niemand richtig. FlowRow bricht stattdessen
 * um; dieselbe Loesung wie bei den Netzschaltern in MonitoringSections.kt.
 *
 * Kein weight(1f) mehr: In einer FlowRow fuehrte es dazu, dass jeder Knopf
 * die ganze Zeile fuellt und damit jeder in seiner eigenen steht. Die Knoepfe
 * nehmen jetzt die Breite ihres Textes.
 */
// Kurzname, nicht vollqualifiziert: Die Datei hat oben
// `import androidx.compose.foundation.layout.*`, also sind sowohl FlowRow als
// auch diese Annotation bereits im Zugriff — und SplitFileImportsTest liest
// aus @OptIn(...) genau den KURZEN Namen („ExperimentalLayoutApi"). Mit dem
// vollen Paketpfad uebersetzt es zwar, aber die Regel sieht ihren Marker nicht
// und meldet die Datei als „nutzt FlowRow ohne @OptIn". GEMESSEN: Genau daran
// war die Android-CI im zweiten Lauf noch rot.
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CsvImportCard(
    csvZustand: ch.brickinventoryapp.ui.CsvHochladenUiState,
    onDatei: (ch.brickinventoryapp.data.model.CsvArt, android.net.Uri) -> Unit,
    onSchliessen: () -> Unit,
) {
    // Welche Art beim Antippen gemeint war. Der Dateiauswahl-Vertrag liefert
    // nur den Uri zurueck, nicht den Knopf — also muss die App es sich merken.
    //
    // rememberSaveable und NICHT remember: Die Dateiauswahl ist eine fremde
    // Anwendung. Waehrend sie oben liegt, darf das System diesen Vorgang
    // beenden; kommt der Nutzer mit einer Teile-Datei zurueck und der Wert ist
    // auf SETS zurueckgefallen, landet sie in der falschen Tabelle. Genau
    // dieser Unterschied ist die Regel von BildschirmZustandTest, und der
    // oertliche Spiegel hat die Stelle prompt gemeldet.
    var gewaehlteArt by rememberSaveable { mutableStateOf(ch.brickinventoryapp.data.model.CsvArt.SETS) }
    val auswahl = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.OpenDocument()
    ) { uri -> if (uri != null) onDatei(gewaehlteArt, uri) }

    // `text/*` UND `text/comma-separated-values`: Manche Dateiverwaltungen
    // geben einer .csv den Typ `application/vnd.ms-excel`, andere gar keinen.
    // Zu eng gefiltert waere die Datei in der Auswahl ausgegraut, ohne dass
    // erkennbar ist, warum.
    val typen = arrayOf("text/csv", "text/comma-separated-values", "text/plain",
                        "application/vnd.ms-excel", "application/octet-stream")

    SettingsCard(title = stringResource(R.string.csv_upload_title), icon = Icons.Default.UploadFile) {
        Text(
            stringResource(R.string.csv_upload_hint,
                (ch.brickinventoryapp.ui.CSV_MAX_BYTES / 1024 / 1024).toInt()),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)

        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
            modifier = Modifier.fillMaxWidth()
        ) {
            listOf(
                ch.brickinventoryapp.data.model.CsvArt.SETS to R.string.csv_upload_sets,
                ch.brickinventoryapp.data.model.CsvArt.TEILE to R.string.csv_upload_parts,
                ch.brickinventoryapp.data.model.CsvArt.MINIFIGUREN to R.string.csv_upload_figs,
                ch.brickinventoryapp.data.model.CsvArt.MERKLISTE to R.string.csv_upload_wanted,
                ch.brickinventoryapp.data.model.CsvArt.PREISALARME to R.string.csv_upload_alerts,
            ).forEach { (art, textId) ->
                OutlinedButton(
                    onClick = { gewaehlteArt = art; auswahl.launch(typen) },
                    enabled = !csvZustand.laeuft,
                    shape = Formen.knopf,
                    contentPadding = PaddingValues(horizontal = Abstaende.klein)
                ) {
                    // Der Kreisel steht NEBEN der Beschriftung, nicht an ihrer
                    // Stelle. Vorher tauschte ein if/else das eine gegen das
                    // andere; das ging nur gut, solange weight(1f) die Breite
                    // festhielt. Ohne weight (seit der FlowRow) schrumpfte der
                    // Knopf waehrend des Imports auf Kreiselgroesse und schob
                    // die drei anderen beiseite.
                    //
                    // Genau das faengt KnopfBreiteTest, und es hat es gefangen:
                    // Die Android-CI war rot, und der Befund war richtig. Das
                    // Muster hier steht dreissig Zeilen weiter unten in dieser
                    // Datei schon einmal (Knopf „Nach Aktualisierung suchen").
                    if (csvZustand.laeuft && csvZustand.art == art) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(Abstaende.winzig))
                    }
                    Text(stringResource(textId), maxLines = 1,
                        style = MaterialTheme.typography.labelLarge)
                }
            }
        }

        val ergebnis = csvZustand.ergebnis
        if (ergebnis != null) {
            Text(
                // Vier Zahlen, und im Englischen stimmen zwei davon ueberein
                // („row/rows", „error/errors"). Ein <plurals> stimmt nur mit
                // EINER ueberein, darum vier Bruchstuecke in einem Rahmen —
                // auch „neu" und „aktualisiert", damit der Rahmen KEIN %d mehr
                // traegt und Lint ihn nicht gleich wieder beanstandet.
                stringResource(R.string.csv_upload_result,
                    pluralStringResource(R.plurals.csv_upload_rows, ergebnis.total, ergebnis.total),
                    pluralStringResource(R.plurals.csv_upload_new, ergebnis.neuAngelegt, ergebnis.neuAngelegt),
                    pluralStringResource(R.plurals.csv_upload_updated, ergebnis.updated, ergebnis.updated),
                    pluralStringResource(R.plurals.csv_upload_errors, ergebnis.errors, ergebnis.errors)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary)
            TextButton(onClick = onSchliessen) { Text(stringResource(R.string.csv_upload_close)) }
        }
        if (csvZustand.fehler != null) {
            Text(csvZustand.fehler, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
            TextButton(onClick = onSchliessen) { Text(stringResource(R.string.csv_upload_close)) }
        }
    }
}
