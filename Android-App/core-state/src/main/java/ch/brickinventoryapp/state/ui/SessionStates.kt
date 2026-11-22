package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.domain.LocationEntryView
import ch.brickinventoryapp.model.domain.LocationView
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.model.ui.Load

/*
 * The state classes live per area in ui/Zustand*.kt; here, what applies alongside
 * the session (core-session, AppUiState): filter, storage locations, the notification target.
 * Whatever changes often has its own flows, so not every AppUiState consumer
 * has to redraw.
 */

/** Account filter and household accounts — held by [Scope]. */
data class ScopeUiState(
    /**
     * Account filter per view. It travels along as
     * `accounts=` and is only resolved on the server, so list, total count,
     * key figures and sums stay consistent.
     */
    val scopeModes: Map<ScopeFilter.View, String> = emptyMap(),
    /**
     * The household's accounts, own first. More than one means: a main account
     * with sub-accounts — only then does an account filter appear, account choice during
     * capture, and the move path.
     */
    val householdMembers: List<MemberView> = emptyList(),
    /** The last fetch of [householdMembers]; on failure the previous members stay. */
    val membersFetch: Load<Unit> = Load.Data(Unit),
)

/**
 * Storage-location filter — a flow of its own: many screens collect AppUiState, and every
 * change would drag them along; only gallery and parts read the storage locations. The
 * account filter stays in AppUiState, because more views and capture need it.
 */
data class StorageUiState(
    /** Chosen storage location PER VIEW — empty means „not filtered“. */
    val modes: Map<ScopeFilter.View, String> = emptyMap(),
    /** The occupied storage locations in the Blickfeld — feeds the FILTER. */
    val locations: List<LocationView> = emptyList(),
    /** The last fetch of [locations] or [stock]; on failure the previous lists stay. */
    val locationsFetch: Load<Unit> = Load.Data(Unit),
    /**
     * The stock for the detail that's currently open — what's available to choose. Not [locations]
     * (the Blickfeld's occupied locations), but the owner's selectable locations; for the
     * grandchild's set, theirs.
     */
    val stock: List<LocationEntryView> = emptyList(),
    /** One's OWN locations — for management in settings. */
    val own: List<LocationEntryView> = emptyList(),
    /**
     * The location already set during capture (the star); null means no default.
     * Comes with [own] from the same response — stock and star are one piece of information.
     */
    val default: LocationEntryView? = null,
)

/**
 * Which set a tapped price-alert notification should open. A flow of its own, because
 * only the activity and NavHost touch it. null means „nothing open“; acknowledged
 * right after navigating, otherwise the app would jump back into the detail on
 * the next recomposition.
 */
data class MessageTargetUiState(
    val setNumber: String? = null,
)
