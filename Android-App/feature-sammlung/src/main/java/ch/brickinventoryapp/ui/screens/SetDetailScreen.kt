package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.viewmodel.SetDetailAktionen
import ch.brickinventoryapp.ui.model.SetAnsicht
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import ch.brickinventoryapp.ressourcen.R
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import ch.brickinventoryapp.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.util.resolveFullUrl
import coil3.ImageLoader
import kotlinx.coroutines.launch
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.DetailTopAppBar
import ch.brickinventoryapp.ui.components.FehlerHinweis
import ch.brickinventoryapp.ui.components.LadeKreis
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.Rueckfrage
import ch.brickinventoryapp.ui.components.ZustandsHinweis
import ch.brickinventoryapp.ui.theme.LocalAkzentflaechen
import ch.brickinventoryapp.ui.viewmodel.ANLEITUNG_TYPEN
import ch.brickinventoryapp.util.fmtMoney
import ch.brickinventoryapp.util.fmtTag

/** Das Set-Detail am Navigationsziel: sammelt die Flüsse und reicht sie an [SetDetailScreen]. */
@Composable
fun SetDetailRoute(
    setNumber: String,
    vm: SetDetailViewModel,
    vorschau: SetAnsicht? = null,
    serverUrl: String,
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onDelete: (String) -> Unit,
    rueckgaengigMoeglich: Boolean = false,
    onNavigateToAcqMgmt: (type: String, id: String, colorId: Int, title: String) -> Unit = { _, _, _, _ -> },
    onOpenPdf: (url: String, title: String) -> Unit = { _, _ -> }
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val detailState by vm.setDetailState.collectAsStateWithLifecycle()
    val lagerZustand by vm.lagerState.collectAsStateWithLifecycle()
    SetDetailScreen(
        setNumber = setNumber, zustand = SetDetailZustand(state, detailState, lagerZustand), aktionen = vm,
        vorschau = vorschau, serverUrl = serverUrl, imageLoader = imageLoader, onBack = onBack, onDelete = onDelete,
        rueckgaengigMoeglich = rueckgaengigMoeglich, onNavigateToAcqMgmt = onNavigateToAcqMgmt, onOpenPdf = onOpenPdf,
    )
}

/** Was das Set-Detail zeigt. */
data class SetDetailZustand(
    val state: AppUiState,
    val detailState: SetDetailUiState,
    val lagerZustand: LagerUiState,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SetDetailScreen(
    setNumber: String,
    zustand: SetDetailZustand,
    aktionen: SetDetailAktionen,
    /** Das Set aus der geladenen Galerie — sofort sichtbar, bis das Detail da ist. */
    vorschau: SetAnsicht? = null,
    serverUrl: String,
    // Die AsyncImage-Aufrufe brauchen diesen Loader: Coils Standard-Loader hängt den
    // Bearer-Token nicht an (den setzt nur der Client aus di/NetzModule.kt), und der
    // Server verlangt für alle Bilder eine Anmeldung — sonst bliebe der Dialog mit 401
    // still leer.
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onDelete: (String) -> Unit,
    /**
     * Fängt die Liste darunter das Löschen mit „Rückgängig“ auf? Dann löscht der Papierkorb
     * ohne Rückfrage — eine Sicherung genügt. Ohne Liste (Einstieg von aussen) fragt er.
     */
    rueckgaengigMoeglich: Boolean = false,
    onNavigateToAcqMgmt: (type: String, id: String, colorId: Int, title: String) -> Unit = { _, _, _, _ -> },
    onOpenPdf: (url: String, title: String) -> Unit = { _, _ -> }
) {
    val state       = zustand.state
    val detailState = zustand.detailState
    // Die Galerie-Liste dient hier nur als Rueckfall, solange das Detail noch
    // laedt — deshalb der eigene Fluss statt des ganzen App-Zustands.
    val set       = detailState.setDetail?.takeIf { it.setNumber == setNumber }
                 ?: vorschau?.takeIf { it.setNumber == setNumber }
    val price     = detailState.setPrice?.takeIf { it.setNumber == setNumber }
    val history   = detailState.priceHistory
    val pnlPct    = history?.pnlProzent
    val currency  = detailState.setPrice?.currency?.ifBlank { state.currency } ?: state.currency
    val coroutineScope = rememberCoroutineScope()
    var showImageZoom by rememberSaveable { mutableStateOf(false) }
    var showSetDeleteConfirm by rememberSaveable { mutableStateOf(false) }

    val acquisitions = detailState.acquisitions

    LaunchedEffect(setNumber) {
        aktionen.loadSetDetail(setNumber)
        aktionen.loadSetPrice(setNumber)
        aktionen.loadSetPriceHistory(setNumber)
        aktionen.loadAcquisitions(setNumber)
        aktionen.loadPreisalarme(setNumber)
    }

    fun fmtPrice(v: Double?) = if (v == null) "—"
        else fmtMoney(v, currency)

    // Gemeinsamer Helfer (util/DatumFormat.kt) — dieselbe Umwandlung stand in
    // MinifigsScreen in einer zweiten, abweichenden Fassung.
    fun fmtDate(iso: String?) = fmtTag(iso) ?: iso ?: "—"

    val akzent = LocalAkzentflaechen.current
    // Snackbar im eigenen Gerüst statt Toast: bleibt lesbar, bis TalkBack fertig ist.
    val meldungen = remember { SnackbarHostState() }
    val keineAppText = stringResource(R.string.common_no_app_to_open)
    val haptik = androidx.compose.ui.platform.LocalHapticFeedback.current
    Scaffold(
        snackbarHost = { SnackbarHost(meldungen) },
        topBar = {
            // Derselbe Kopf wie in Katalog, Merkliste und Teilen (DetailTopAppBar).
            DetailTopAppBar(
                titel = set?.name ?: setNumber,
                onZurueck = onBack,
                farben = TopAppBarDefaults.topAppBarColors(
                    containerColor = akzent.detailLeiste,
                    titleContentColor = akzent.aufDetailLeiste,
                    navigationIconContentColor = akzent.aufDetailLeiste,
                    actionIconContentColor = akzent.aufDetailLeiste,
                ),
                actions = {
                    // Kein Verschieben-Knopf: Verschoben wird über den Kaufpreis, Zeile für Zeile —
                    // ein Set mit drei Erfassungen sind drei Käufe, die verschiedenen Kindern gehören
                    // können. Der Server erzwingt dasselbe (move ohne acquisition_ids: 400).
                    MitTooltip(stringResource(R.string.cd_set_delete, set?.name ?: setNumber)) {
                        IconButton(onClick = {
                            haptik.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress)
                            if (rueckgaengigMoeglich) onDelete(setNumber) else showSetDeleteConfirm = true
                        }) {
                            Icon(Icons.Default.Delete, stringResource(R.string.cd_set_delete, set?.name ?: setNumber))
                        }
                    }
                },
            )
        },
        containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
    ) { padding ->

        if (set == null) {
            // Ohne Detail und ohne Vorschau: laden oder gescheitert — nie ein Kringel ohne Ende.
            val fehler = detailState.setDetailFehler
            if (fehler != null && !detailState.setDetailLoading) {
                ZustandsHinweis(Modifier.padding(padding)) {
                    FehlerHinweis(fehler, { aktionen.loadSetDetail(setNumber) },
                        detailState.setDetailFehlerKlasse)
                }
            } else LadeKreis(Modifier.padding(padding))
            return@Scaffold
        }

        // Volle Auflösung — wie der Detail-Dialog der Webapp (07-admin.js, "m-img",
        // fullUrl()). Vorschau-Karte und Zoom benutzen dieselbe Adresse.
        val imageUrl = resolveFullUrl(serverUrl, set.imageLocal, set.imageUrl)
        // Einmaliger, verzögerter Wiederholversuch — wie in der Galerie-Kachel: Direkt
        // nach dem Erfassen ist die Datei auf dem Server oft noch nicht fertig, und Coil
        // versucht von sich aus nie erneut; die Fläche bliebe leer bis zum nächsten
        // Öffnen.
        // Ausführlich: docs/begruendungen/feature-sammlung/ui/screens/SetDetailScreen.kt.md#detailretrystate
        val detailRetryState = remember(set.setNumber, imageUrl) { mutableIntStateOf(0) }
        val detailScope = rememberCoroutineScope()
        val zoomImageUrl = imageUrl

        // Die Dateiauswahl für eine Anleitung. Hier und nicht im Abschnitt darunter: Ein
        // `LazyListScope` ist kein Composable-Kontext, und ein Starter, der beim Scrollen
        // neu entstünde, verlöre seine Rückmeldung. Die Typenliste kommt aus
        // SetDetailFeature — dieselbe, die der Server annimmt.
        val anleitungAuswahl = androidx.activity.compose.rememberLauncherForActivityResult(
            androidx.activity.result.contract.ActivityResultContracts.OpenDocument()
        ) { uri -> if (uri != null) aktionen.ladeAnleitungHoch(setNumber, uri) }

        val kopf: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
            setDetailHeroImage(set, imageUrl, imageLoader, detailRetryState, detailScope) { showImageZoom = true }
            setDetailStatChips(set)
            setDetailValueTiles(set, price, pnlPct, ::fmtPrice)
        }
        val angaben: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
            setDetailDetailsSection(set, setNumber, zustand.lagerZustand, aktionen, acquisitions, currency, ::fmtDate, onNavigateToAcqMgmt)
            setDetailAlarmSection(setNumber, detailState.preisalarme, currency, aktionen::setzePreisalarm)
        }
        val preise: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
            setDetailPriceSection(detailState, price, history, currency)
        }
        val anleitungen: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
            setDetailInstructionsSection(
                set, detailState, serverUrl, onOpenPdf,
                onAnleitungWaehlen = { anleitungAuswahl.launch(ANLEITUNG_TYPEN) },
                onAnleitungLoeschen = { aktionen.loescheAnleitung(setNumber, it) },
                onKeineApp = { coroutineScope.launch { meldungen.showSnackbar(keineAppText) } },
            )
        }
        // Ab „expanded“ zwei Spalten — Bild und Preise links, Angaben, Alarm und
        // Anleitungen rechts: Einspaltig lagen Bezeichnung und Wert einer Zeile auf dem
        // Tablet eine Armlänge auseinander. Einspaltig kommen die Preise vor den Angaben:
        // Der Wert ist die erste Frage an ein Set, nicht das Erfassungsdatum.
        BoxWithConstraints(Modifier.fillMaxSize().padding(padding)) {
            val rand = PaddingValues(bottom = Abstaende.sehrGross)
            if (zweiSpaltig(maxWidth.value)) {
                Row(Modifier.fillMaxSize()) {
                    LazyColumn(Modifier.weight(1f).fillMaxHeight(), contentPadding = rand) { kopf(); preise() }
                    LazyColumn(Modifier.weight(1f).fillMaxHeight(), contentPadding = rand) { angaben(); anleitungen() }
                }
            } else {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = rand) { kopf(); preise(); angaben(); anleitungen() }
            }
        }

        if (showSetDeleteConfirm) {
            val name = set.name ?: setNumber
            Rueckfrage(
                titel = stringResource(R.string.gallery_delete_title),
                // Bei mehreren Exemplaren sagt der Satz, dass alle gemeint sind.
                text = if (set.quantity > 1) pluralStringResource(R.plurals.gallery_delete_text_exemplare, set.quantity, set.quantity, name)
                       else stringResource(R.string.gallery_delete_text, name),
                bestaetigen = stringResource(R.string.common_delete),
                onBestaetigen = { showSetDeleteConfirm = false; onDelete(setNumber) },
                onAbbrechen = { showSetDeleteConfirm = false },
                symbol = Icons.Default.Delete,
            )
        }

        if (showImageZoom && zoomImageUrl != null) {
            // Gemeinsame Umsetzung mit dem Katalog-Detail
            // (ui/components/ZoomableImageDialog.kt), damit Gesten- und Zustandslogik nur
            // einmal existieren.
            ZoomableImageDialog(
                imageUrl = zoomImageUrl,
                contentDescription = set.name,
                imageLoader = imageLoader,
                onDismiss = { showImageZoom = false }
            )
        }
    }
}
