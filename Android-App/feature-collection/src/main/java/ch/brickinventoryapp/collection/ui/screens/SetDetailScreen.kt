package ch.brickinventoryapp.collection.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.collection.ui.SetDetailUiState
import ch.brickinventoryapp.collection.ui.viewmodel.INSTRUCTION_TYPES
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailActions
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.util.resolveFullUrl
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.shared.ui.LocalColumnMap
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.ui.components.DetailTopAppBar
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.ui.components.LoadCircle
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.components.StateHint
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.LocalAccentSurfaces
import ch.brickinventoryapp.ui.theme.ReadingWidth
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.title
import ch.brickinventoryapp.ui.twoColumn
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtTag
import coil3.ImageLoader
import kotlinx.coroutines.launch
import java.time.Instant

/** The set detail at the navigation destination: gathers the flows and passes them to [SetDetailScreen]. */
@Composable
fun SetDetailRoute(
    setNumber: String,
    vm: SetDetailViewModel,
    preview: SetView? = null,
    serverUrl: String,
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onDelete: (String) -> Unit,
    undoPossible: Boolean = false,
    onNavigateToAcqMgmt: (type: ItemKind, id: String, colorId: Int, title: String) -> Unit = { _, _, _, _ -> },
    onOpenPdf: (url: String, title: String) -> Unit = { _, _ -> }
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val detailState by vm.setDetailState.collectAsStateWithLifecycle()
    val storageUiState by vm.storageState.collectAsStateWithLifecycle()
    SetDetailScreen(
        setNumber = setNumber, condition = SetDetailState(state, detailState, storageUiState), actions = vm,
        preview = preview, serverUrl = serverUrl, imageLoader = imageLoader, onBack = onBack, onDelete = onDelete,
        undoPossible = undoPossible, onNavigateToAcqMgmt = onNavigateToAcqMgmt, onOpenPdf = onOpenPdf,
    )
}

/** What the set detail shows. */
internal data class SetDetailState(
    val state: AppUiState,
    val detailState: SetDetailUiState,
    val storageUiState: StorageUiState,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SetDetailScreen(
    setNumber: String,
    condition: SetDetailState,
    actions: SetDetailActions,
    /** The set from the loaded gallery — visible right away, until the detail is there. */
    preview: SetView? = null,
    serverUrl: String,
    // The AsyncImage calls need this loader: Coil's default loader doesn't attach the
    // bearer token (only the client from di/NetworkModule.kt sets that), and the
    // server requires sign-in for every image — otherwise the dialog would silently
    // stay empty with a 401.
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onDelete: (String) -> Unit,
    /**
     * Does the list below catch the deletion with "Undo"? Then the trash icon deletes
     * without a confirmation — one safeguard is enough. Without a list (entry from outside), it asks.
     */
    undoPossible: Boolean = false,
    onNavigateToAcqMgmt: (type: ItemKind, id: String, colorId: Int, title: String) -> Unit = { _, _, _, _ -> },
    onOpenPdf: (url: String, title: String) -> Unit = { _, _ -> }
) {
    val state       = condition.state
    val detailState = condition.detailState
    // The gallery list only serves as a fallback here, while the detail is still
    // loading — hence its own flow instead of the whole app state.
    val set       = detailState.setDetail?.takeIf { it.setNumber == setNumber }
                 ?: preview?.takeIf { it.setNumber == setNumber }
    val price     = detailState.setPrice?.takeIf { it.setNumber == setNumber }
    val history   = detailState.priceHistory
    val pnlPct    = history?.pnlPercent
    val currency  = detailState.setPrice?.currency?.takeIf { it.known } ?: state.currency
    val coroutineScope = rememberCoroutineScope()
    var showImageZoom by rememberSaveable { mutableStateOf(false) }
    var showSetDeleteConfirm by rememberSaveable { mutableStateOf(false) }

    val acquisitions = detailState.acquisitions

    fun fmtPrice(v: Money?) = if (v == null) "—"
        else fmtMoney(v, currency)

    // Gemeinsamer Helfer (util/DatumFormat.kt) — dieselbe Umwandlung stand in
    // MinifigsScreen in einer zweiten, abweichenden Fassung.
    fun fmtDate(time: Instant?) = fmtTag(time) ?: "—"

    val accent = LocalAccentSurfaces.current
    // Snackbar in its own scaffold instead of Toast: stays readable until TalkBack is done.
    val messages = remember { SnackbarHostState() }
    val noAppText = stringResource(R.string.common_no_app_to_open)
    val haptics = androidx.compose.ui.platform.LocalHapticFeedback.current
    Scaffold(
        snackbarHost = { SnackbarHost(messages) },
        topBar = {
            // The same header as in catalog, watchlist and parts (DetailTopAppBar).
            DetailTopAppBar(
                title = set?.name ?: setNumber,
                onBack = onBack,
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = accent.detailBar,
                    titleContentColor = accent.onDetailBar,
                    navigationIconContentColor = accent.onDetailBar,
                    actionIconContentColor = accent.onDetailBar,
                ),
                actions = {
                    // No move button: moving happens via the purchase price, row by row —
                    // a set with three entries is three purchases that can belong to different
                    // children. The server enforces the same (move without acquisition_ids: 400).
                    WithTooltip(stringResource(R.string.cd_set_delete, set?.name ?: setNumber)) {
                        IconButton(onClick = {
                            haptics.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress)
                            if (undoPossible) onDelete(setNumber) else showSetDeleteConfirm = true
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
            val error = detailState.detailFetch as? Load.Failure
            if (error != null) {
                StateHint(Modifier.padding(padding)) {
                    ErrorHint(error.message.sentence(), actions::refresh, error.kind)
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
        ) { uri -> if (uri != null) actions.loadInstructionHigh(setNumber, FileRef(uri.toString())) }

        val header: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
            setDetailHeroImage(set, imageUrl, imageLoader, detailRetryState, detailScope) { showImageZoom = true }
            setDetailStatChips(set)
            setDetailValueTiles(set, price, pnlPct, ::fmtPrice)
        }
        val info: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
            setDetailDetailsSection(set, setNumber, condition.storageUiState, actions, acquisitions, currency, ::fmtDate, onNavigateToAcqMgmt)
            setDetailAlarmSection(setNumber, detailState.priceAlarms, currency, actions::setPriceAlert)
        }
        val prices: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
            setDetailPriceSection(detailState, price, history, currency, actions::refresh)
        }
        val instructions: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
            setDetailInstructionsSection(
                set, detailState, serverUrl, onOpenPdf,
                onInstructionChoose = { instructionSelection.launch(INSTRUCTION_TYPES) },
                onInstructionDelete = { actions.deleteInstruction(setNumber, it) },
                onNoApp = { coroutineScope.launch { messages.showSnackbar(noAppText) } },
            )
        }
        // Two columns from "expanded" on — image and prices on the left, details, alert and
        // manuals on the right: single-column, a row's label and value sat an
        // arm's length apart on the tablet. Single-column, the prices come before the details:
        // the value is the first question about a set, not the entry date.
        BoxWithConstraints(Modifier.fillMaxSize().padding(padding)) {
            val edge = PaddingValues(bottom = Spacing.veryLarge)
            if (twoColumn(maxWidth.value)) {
                Row(Modifier.fillMaxSize()) {
                    CompositionLocalProvider(LocalColumnMap provides true) {
                        LazyColumn(Modifier.weight(1f).fillMaxHeight(), contentPadding = edge) { header(); prices() }
                        LazyColumn(Modifier.weight(1f).fillMaxHeight(), contentPadding = edge) { info(); instructions() }
                    }
                }
            } else {
                // One column with a max width for all cards: in portrait on the tablet,
                // the price history (SectionCard, Lesebreite) sat narrower than the tiles above it.
                val lateral = ((maxWidth - DETAIL_COLUMN) / 2).coerceAtLeast(0.dp)
                CompositionLocalProvider(LocalColumnMap provides true) {
                    LazyColumn(Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = lateral, end = lateral, bottom = Spacing.veryLarge)) {
                        header(); prices(); info(); instructions()
                    }
                }
            }
        }

        if (showSetDeleteConfirm) {
            val name = set.name ?: setNumber
            Prompt(
                title = stringResource(R.string.gallery_delete_title),
                // With several copies, the sentence says all of them are meant.
                text = if (set.quantity > 1) pluralStringResource(R.plurals.gallery_delete_text_copies, set.quantity, set.quantity, name)
                       else stringResource(R.string.gallery_delete_text, name),
                confirm = stringResource(R.string.common_delete),
                onConfirm = { showSetDeleteConfirm = false; onDelete(setNumber) },
                onCancel = { showSetDeleteConfirm = false },
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
private val DETAIL_COLUMN = ReadingWidth.form + Spacing.large * 2
