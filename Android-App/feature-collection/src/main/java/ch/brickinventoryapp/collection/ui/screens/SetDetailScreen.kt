package ch.brickinventoryapp.collection.ui.screens

import java.time.Instant
import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailAktionen
import ch.brickinventoryapp.model.domain.SetAnsicht
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import ch.brickinventoryapp.resources.R
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.mutableIntStateOf
import ch.brickinventoryapp.shared.ui.LocalSpaltenkarte
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.collection.ui.SetDetailUiState
import ch.brickinventoryapp.ui.titel
import ch.brickinventoryapp.ui.twoSpaltig
import ch.brickinventoryapp.state.ui.LagerUiState
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.model.util.resolveFullUrl
import coil3.ImageLoader
import kotlinx.coroutines.launch
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Lesebreite
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.components.DetailTopAppBar
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.ui.components.LoadCircle
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.components.StateHint
import ch.brickinventoryapp.ui.theme.LocalAkzentflaechen
import ch.brickinventoryapp.collection.ui.viewmodel.INSTRUCTION_TYPES
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtTag
import ch.brickinventoryapp.model.file.FileRef

/** The set detail at the navigation destination: gathers the flows and passes them to [SetDetailScreen]. */
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
    onNavigateToAcqMgmt: (type: Postenart, id: String, colorId: Int, title: String) -> Unit = { _, _, _, _ -> },
    onOpenPdf: (url: String, title: String) -> Unit = { _, _ -> }
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val detailState by vm.setDetailState.collectAsStateWithLifecycle()
    val lagerZustand by vm.storageState.collectAsStateWithLifecycle()
    SetDetailScreen(
        setNumber = setNumber, zustand = SetDetailZustand(state, detailState, lagerZustand), aktionen = vm,
        vorschau = vorschau, serverUrl = serverUrl, imageLoader = imageLoader, onBack = onBack, onDelete = onDelete,
        rueckgaengigMoeglich = rueckgaengigMoeglich, onNavigateToAcqMgmt = onNavigateToAcqMgmt, onOpenPdf = onOpenPdf,
    )
}

/** What the set detail shows. */
internal data class SetDetailZustand(
    val state: AppUiState,
    val detailState: SetDetailUiState,
    val lagerZustand: LagerUiState,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SetDetailScreen(
    setNumber: String,
    zustand: SetDetailZustand,
    aktionen: SetDetailAktionen,
    /** The set from the loaded gallery — visible right away, until the detail is there. */
    vorschau: SetAnsicht? = null,
    serverUrl: String,
    // The AsyncImage calls need this loader: Coil's default loader doesn't attach the
    // bearer token (only the client from di/NetzModule.kt sets that), and the
    // server requires sign-in for every image — otherwise the dialog would silently
    // stay empty with a 401.
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onDelete: (String) -> Unit,
    /**
     * Does the list below catch the deletion with "Undo"? Then the trash icon deletes
     * without a confirmation — one safeguard is enough. Without a list (entry from outside), it asks.
     */
    rueckgaengigMoeglich: Boolean = false,
    onNavigateToAcqMgmt: (type: Postenart, id: String, colorId: Int, title: String) -> Unit = { _, _, _, _ -> },
    onOpenPdf: (url: String, title: String) -> Unit = { _, _ -> }
) {
    val state       = zustand.state
    val detailState = zustand.detailState
    // The gallery list only serves as a fallback here, while the detail is still
    // loading — hence its own flow instead of the whole app state.
    val set       = detailState.setDetail?.takeIf { it.setNumber == setNumber }
                 ?: vorschau?.takeIf { it.setNumber == setNumber }
    val price     = detailState.setPrice?.takeIf { it.setNumber == setNumber }
    val history   = detailState.priceHistory
    val pnlPct    = history?.pnlProzent
    val currency  = detailState.setPrice?.currency?.takeIf { it.bekannt } ?: state.currency
    val coroutineScope = rememberCoroutineScope()
    var showImageZoom by rememberSaveable { mutableStateOf(false) }
    var showSetDeleteConfirm by rememberSaveable { mutableStateOf(false) }

    val acquisitions = detailState.acquisitions

    fun fmtPrice(v: Geld?) = if (v == null) "—"
        else fmtMoney(v, currency)

    // Gemeinsamer Helfer (util/DatumFormat.kt) — dieselbe Umwandlung stand in
    // MinifigsScreen in einer zweiten, abweichenden Fassung.
    fun fmtDate(zeit: Instant?) = fmtTag(zeit) ?: "—"

    val accent = LocalAkzentflaechen.current
    // Snackbar in its own scaffold instead of Toast: stays readable until TalkBack is done.
    val meldungen = remember { SnackbarHostState() }
    val noAppText = stringResource(R.string.common_no_app_to_open)
    val haptics = androidx.compose.ui.platform.LocalHapticFeedback.current
    Scaffold(
        snackbarHost = { SnackbarHost(meldungen) },
        topBar = {
            // The same header as in catalog, watchlist and parts (DetailTopAppBar).
            DetailTopAppBar(
                titel = set?.name ?: setNumber,
                onZurueck = onBack,
                farben = TopAppBarDefaults.topAppBarColors(
                    containerColor = accent.detailLeiste,
                    titleContentColor = accent.onDetailBar,
                    navigationIconContentColor = accent.onDetailBar,
                    actionIconContentColor = accent.onDetailBar,
                ),
                actions = {
                    // No move button: moving happens via the purchase price, row by row —
                    // a set with three entries is three purchases that can belong to different
                    // children. The server enforces the same (move without acquisition_ids: 400).
                    MitTooltip(stringResource(R.string.cd_set_delete, set?.name ?: setNumber)) {
                        IconButton(onClick = {
                            haptics.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress)
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
            // Without a detail and without a preview: loading or failed — never a spinner with no end.
            val fehler = detailState.detailFetch as? Laden.Fehler
            if (fehler != null) {
                StateHint(Modifier.padding(padding)) {
                    ErrorHint(fehler.meldung.satz(), aktionen::refresh, fehler.art)
                }
            } else LoadCircle(Modifier.padding(padding))
            return@Scaffold
        }

        // Full resolution — like the web app's detail dialog (admin.js, "m-img",
        // fullUrl()). The preview card and zoom use the same address.
        val imageUrl = resolveFullUrl(serverUrl, set.imageLocal, set.imageUrl)
        // One delayed retry — as in the gallery tile: right
        // after entering, the file is often not ready yet on the server, and Coil
        // never retries on its own; the area would stay empty until the next
        // open.
        val detailRetryState = remember(set.setNumber, imageUrl) { mutableIntStateOf(0) }
        val detailScope = rememberCoroutineScope()
        val zoomImageUrl = imageUrl

        // The file picker for a manual. Here and not in the section below: a
        // `LazyListScope` isn't a Composable context, and a launcher recreated on
        // scroll would lose its callback. The type list comes from
        // SetDetailFeature — the same one the server accepts.
        val instructionSelection = androidx.activity.compose.rememberLauncherForActivityResult(
            androidx.activity.result.contract.ActivityResultContracts.OpenDocument()
        ) { uri -> if (uri != null) aktionen.loadInstructionHigh(setNumber, FileRef(uri.toString())) }

        val kopf: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
            setDetailHeroImage(set, imageUrl, imageLoader, detailRetryState, detailScope) { showImageZoom = true }
            setDetailStatChips(set)
            setDetailValueTiles(set, price, pnlPct, ::fmtPrice)
        }
        val angaben: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
            setDetailDetailsSection(set, setNumber, zustand.lagerZustand, aktionen, acquisitions, currency, ::fmtDate, onNavigateToAcqMgmt)
            setDetailAlarmSection(setNumber, detailState.preisalarme, currency, aktionen::setPriceAlert)
        }
        val preise: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
            setDetailPriceSection(detailState, price, history, currency, aktionen::refresh)
        }
        val anleitungen: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
            setDetailInstructionsSection(
                set, detailState, serverUrl, onOpenPdf,
                onInstructionChoose = { instructionSelection.launch(INSTRUCTION_TYPES) },
                onAnleitungLoeschen = { aktionen.loescheAnleitung(setNumber, it) },
                onNoApp = { coroutineScope.launch { meldungen.showSnackbar(noAppText) } },
            )
        }
        // Two columns from "expanded" on — image and prices on the left, details, alert and
        // manuals on the right: single-column, a row's label and value sat an
        // arm's length apart on the tablet. Single-column, the prices come before the details:
        // the value is the first question about a set, not the entry date.
        BoxWithConstraints(Modifier.fillMaxSize().padding(padding)) {
            val edge = PaddingValues(bottom = Abstaende.veryLarge)
            if (twoSpaltig(maxWidth.value)) {
                Row(Modifier.fillMaxSize()) {
                    CompositionLocalProvider(LocalSpaltenkarte provides true) {
                        LazyColumn(Modifier.weight(1f).fillMaxHeight(), contentPadding = edge) { kopf(); preise() }
                        LazyColumn(Modifier.weight(1f).fillMaxHeight(), contentPadding = edge) { angaben(); anleitungen() }
                    }
                }
            } else {
                // One column with a max width for all cards: in portrait on the tablet,
                // the price history (SectionCard, Lesebreite) sat narrower than the tiles above it.
                val lateral = ((maxWidth - DETAIL_COLUMN) / 2).coerceAtLeast(0.dp)
                CompositionLocalProvider(LocalSpaltenkarte provides true) {
                    LazyColumn(Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = lateral, end = lateral, bottom = Abstaende.veryLarge)) {
                        kopf(); preise(); angaben(); anleitungen()
                    }
                }
            }
        }

        if (showSetDeleteConfirm) {
            val name = set.name ?: setNumber
            Prompt(
                titel = stringResource(R.string.gallery_delete_title),
                // With several copies, the sentence says all of them are meant.
                text = if (set.quantity > 1) pluralStringResource(R.plurals.gallery_delete_text_exemplare, set.quantity, set.quantity, name)
                       else stringResource(R.string.gallery_delete_text, name),
                bestaetigen = stringResource(R.string.common_delete),
                onBestaetigen = { showSetDeleteConfirm = false; onDelete(setNumber) },
                onAbbrechen = { showSetDeleteConfirm = false },
                symbol = Icons.Default.Delete,
            )
        }

        if (showImageZoom && zoomImageUrl != null) {
            // Shared implementation with the catalog detail
            // (ui/components/ZoomableImageDialog.kt), so the gesture and state logic only
            // exists once.
            ZoomableImageDialog(
                imageUrl = zoomImageUrl,
                contentDescription = set.name,
                imageLoader = imageLoader,
                onDismiss = { showImageZoom = false }
            )
        }
    }
}

/** Max width of the single-column detail page: the reading width plus the cards' margin. */
private val DETAIL_COLUMN = Lesebreite.formular + Abstaende.gross * 2
