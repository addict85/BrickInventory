package ch.brickinventoryapp.ui.screens

import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.util.fmtDatum
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.R
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.util.resolveFullUrl
import coil3.ImageLoader
import ch.brickinventoryapp.ui.theme.Abstaende

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SetDetailScreen(
    setNumber: String,
    vm: SetDetailViewModel,
    /** Das Set aus der geladenen Galerie — sofort sichtbar, bis das Detail da ist. */
    vorschau: ch.brickinventoryapp.data.model.SetItem? = null,
    serverUrl: String,
    // Die AsyncImage-Aufrufe brauchen diesen Loader: Coils Standard-Loader hängt den
    // Bearer-Token nicht an (den setzt nur der Client aus di/NetzModule.kt), und der
    // Server verlangt für alle Bilder eine Anmeldung — sonst bliebe der Dialog mit 401
    // still leer.
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onDelete: (String) -> Unit,
    onNavigateToAcqMgmt: (type: String, id: String, colorId: Int, title: String) -> Unit = { _, _, _, _ -> },
    onOpenPdf: (url: String, title: String) -> Unit = { _, _ -> }
) {
    val state       by vm.state.collectAsStateWithLifecycle()
    // Detail-Zustand aus eigenem Flow — Preis-/History-Loads rekomponieren
    // so nur noch diesen Screen, nicht alle AppUiState-Konsumenten.
    val detailState by vm.setDetailState.collectAsStateWithLifecycle()
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
        vm.loadSetDetail(setNumber)
        vm.loadSetPrice(setNumber)
        vm.loadSetPriceHistory(setNumber)
        vm.loadAcquisitions(setNumber)
        vm.loadPreisalarme(setNumber)
    }

    fun fmtPrice(v: Double?) = if (v == null) "—"
        else ch.brickinventoryapp.util.fmtMoney(v, currency)

    // Gemeinsamer Helfer (util/DatumFormat.kt) — dieselbe Umwandlung stand in
    // MinifigsScreen in einer zweiten, abweichenden Fassung.
    fun fmtDate(iso: String?) = fmtDatum(iso) ?: iso ?: "—"

    val isBrick = LocalIsBrickTheme.current
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        set?.name ?: setNumber,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.semantics { heading() },
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.common_back))
                    }
                },
                actions = {
                    // Kein Verschieben-Knopf: Verschoben wird über den Kaufpreis, im
                    // Kaufpreis-Screen, Zeile für Zeile. Ein Set mit drei Erfassungen sind drei
                    // Käufe, die verschiedenen Kindern gehören können — „das Set verschieben“
                    // verdeckte, was wandert. Der Server erzwingt dieselbe Regel: move ohne
                    // acquisition_ids antwortet mit 400.
                    IconButton(onClick = { showSetDeleteConfirm = true }) {
                        Icon(Icons.Default.Delete, stringResource(R.string.common_delete))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = if (isBrick) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.surface,
                    titleContentColor = if (isBrick) MaterialTheme.colorScheme.onSecondary else MaterialTheme.colorScheme.onSurface,
                    navigationIconContentColor = if (isBrick) MaterialTheme.colorScheme.onSecondary else MaterialTheme.colorScheme.onSurfaceVariant,
                    actionIconContentColor = if (isBrick) MaterialTheme.colorScheme.onSecondary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            )
        },
        containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
    ) { padding ->

        if (set == null) {
            // Ohne Detail und ohne Vorschau: laden oder gescheitert — nie ein Kringel ohne Ende.
            val fehler = detailState.setDetailFehler
            if (fehler != null && !detailState.setDetailLoading) {
                ch.brickinventoryapp.ui.components.ZustandsHinweis(Modifier.padding(padding)) {
                    ch.brickinventoryapp.ui.components.FehlerHinweis(fehler) { vm.loadSetDetail(setNumber) }
                }
            } else ch.brickinventoryapp.ui.components.LadeKreis(Modifier.padding(padding))
            return@Scaffold
        }

        // Volle Auflösung — wie der Detail-Dialog der Webapp (07-admin.js, "m-img",
        // fullUrl()). Vorschau-Karte und Zoom benutzen dieselbe Adresse.
        val imageUrl = resolveFullUrl(serverUrl, set.imageLocal, set.imageUrl)
        // Einmaliger, verzögerter Wiederholversuch — wie in der Galerie-Kachel: Direkt
        // nach dem Erfassen ist die Datei auf dem Server oft noch nicht fertig, und Coil
        // versucht von sich aus nie erneut; die Fläche bliebe leer bis zum nächsten
        // Öffnen.
        //
        // An setNumber und imageUrl gebunden, damit die Zählung bei einem Wechsel neu
        // beginnt. memoryCacheKeyExtra macht die zweite Anfrage für Coil unterscheidbar,
        // sonst gälte sie als dieselbe gescheiterte. Als State-Objekt statt per `by`:
        // setDetailHeroImage() setzt den Wert im Fehlerzweig, dafür muss es dasselbe
        // Objekt sein, keine Kopie.
        val detailRetryState = remember(set.setNumber, imageUrl) { mutableIntStateOf(0) }
        val detailScope = rememberCoroutineScope()
        val zoomImageUrl = imageUrl

        // Die Dateiauswahl für eine Anleitung. Hier und nicht im Abschnitt darunter: Ein
        // `LazyListScope` ist kein Composable-Kontext, und ein Starter, der beim Scrollen
        // neu entstünde, verlöre seine Rückmeldung. Die Typenliste kommt aus
        // SetDetailFeature — dieselbe, die der Server annimmt.
        val anleitungAuswahl = androidx.activity.compose.rememberLauncherForActivityResult(
            androidx.activity.result.contract.ActivityResultContracts.OpenDocument()
        ) { uri -> if (uri != null) vm.ladeAnleitungHoch(setNumber, uri) }

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(bottom = Abstaende.sehrGross),
            verticalArrangement = Arrangement.spacedBy(0.dp)
        ) {

            setDetailHeroImage(set, imageUrl, imageLoader, detailRetryState, detailScope) { showImageZoom = true }
            setDetailStatChips(set)
            setDetailValueTiles(set, price, isBrick, ::fmtPrice)
            setDetailDetailsSection(set, setNumber, vm, acquisitions, currency, ::fmtDate, onNavigateToAcqMgmt)
            setDetailAlarmSection(setNumber, detailState.preisalarme, currency, vm::setzePreisalarm)
            setDetailPriceSection(set, detailState, price, history, pnlPct, currency, isBrick, ::fmtPrice)
            setDetailInstructionsSection(
                set, detailState, serverUrl, onOpenPdf,
                onAnleitungWaehlen = { anleitungAuswahl.launch(ch.brickinventoryapp.ui.viewmodel.ANLEITUNG_TYPEN) },
                onAnleitungLoeschen = { vm.loescheAnleitung(setNumber, it) },
            )
        }

        if (showSetDeleteConfirm) {
            AlertDialog(
                onDismissRequest = { showSetDeleteConfirm = false },
                icon = { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) },
                title = { Text(stringResource(R.string.gallery_delete_title)) },
                text = { Text(stringResource(R.string.gallery_delete_text, set.name ?: setNumber)) },
                confirmButton = {
                    TextButton(onClick = { showSetDeleteConfirm = false; onDelete(setNumber) }) {
                        Text(stringResource(R.string.common_delete), color = MaterialTheme.colorScheme.error)
                    }
                },
                dismissButton = { TextButton(onClick = { showSetDeleteConfirm = false }) { Text(stringResource(R.string.common_cancel)) } }
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

