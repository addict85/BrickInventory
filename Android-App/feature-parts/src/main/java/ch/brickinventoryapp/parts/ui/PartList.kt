package ch.brickinventoryapp.parts.ui

import ch.brickinventoryapp.model.domain.AccountSelection
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import ch.brickinventoryapp.model.domain.FigureView
import ch.brickinventoryapp.model.domain.PartView
import ch.brickinventoryapp.model.domain.PartialKey
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.SetCatalogRepository
import ch.brickinventoryapp.data.repository.PartsRepository
import ch.brickinventoryapp.parts.ui.screens.comparePartNumbers
import ch.brickinventoryapp.parts.ui.screens.plColorCollator
import ch.brickinventoryapp.model.util.IMG_PROXY
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Inject

@Module
@InstallIn(SingletonComponent::class)
internal interface PartListsModule {
    @Binds fun source(t: PartList): PartListsSource
}

/**
 * The temporary parts list: resolve a set into its parts and figures and
 * fetch one's own stock for them. Stateless — the list is held by
 * PartListViewModel; here only the flows against the repositories live.
 */
internal class PartList @Inject constructor(
    private val catalog: SetCatalogRepository,
    private val partsRepo: PartsRepository,
) : PartListsSource {
    /** Name and rows of a set; identical parts (Rebrickable number + color) merged. */
    override suspend fun resolveSetOn(setNumber: String, serverUrl: String): Pair<String, List<PlPart>> {
        return catchUnlessCancelled {
            // The CSV endpoints are not tied to the account and work for any set.
            val partsResult = catalog.getSetPartsList(setNumber)
            val figsResult  = catalog.getSetMinifigsList(setNumber)
            // The name comes from the catalog (/sets/info), not from one's own
            // stock: one is entering exactly the sets into the parts list that one does not have.
            val setName = (catalog.getSetInfo(setNumber) as? Outcome.Success)
                ?.data?.takeIf { it.isNotBlank() } ?: setNumber
            // Merged by the Rebrickable number, because the stock
            // (withInventory) is queried by it. Several Rebrickable parts often
            // share one BrickLink number; merging by that one made an existing
            // part count as missing. The BrickLink number is still what is shown.
            val deduped = mutableMapOf<String, PlPart>()
            if (partsResult is Outcome.Success) {
                for (p in partsResult.data) combineTogether(deduped, "${p.partNumber}|${p.colorId}", partRow(p, serverUrl))
            }
            // Figures as a whole, not broken down into their parts — as in the web app.
            if (figsResult is Outcome.Success) {
                for (f in figsResult.data) combineTogether(deduped, "fig:${f.figNumber}", minifigRow(f, serverUrl))
            }
            Pair(setName, deduped.values.toList())
        }.getOrElse { Pair(setNumber, listOf()) }
    }

    /** File a row under [key]; if it already exists, only its quantity is added. */
    private fun combineTogether(deduped: MutableMap<String, PlPart>, key: String, row: PlPart) {
        val existing = deduped[key]
        deduped[key] = existing?.copy(quantity = existing.quantity + row.quantity) ?: row
    }

    private fun partRow(p: PartView, serverUrl: String): PlPart {
        val blNum = p.blPartNumber ?: p.partNumber
        return PlPart(
            partNumber    = p.partNumber,
            blPartNumber  = blNum.takeIf { it != p.partNumber },
            partName      = p.partName ?: p.partNumber,
            colorName     = p.colorName ?: "",
            colorHex      = p.colorHex,
            colorId       = p.colorId,
            blColorId     = p.blColorId,
            quantity      = p.totalQuantity.takeIf { it > 0 } ?: 1,
            imageUrl      = imageViaServer(serverUrl.trimEnd('/'), p.imageLocal, p.imageUrl),
            imageLocal    = p.imageLocal
        )
    }

    /**
     * Images always via the server: image_local and paths are server-relative,
     * raw CDN addresses need the proxy's headers.
     */
    private fun imageViaServer(serverBase: String, imageLocal: String?, image: String?): String? = when {
        imageLocal != null -> "$serverBase$imageLocal"
        image == null -> null
        image.startsWith("/") -> "$serverBase$image"
        image.startsWith("https://") || image.startsWith("http://") ->
            // Not yet routed through the server: Coil must not ask a CDN directly.
            "$serverBase$IMG_PROXY?url=${java.net.URLEncoder.encode(image, "UTF-8")}"
        else -> "$serverBase$image"
    }

    private fun minifigRow(f: FigureView, serverUrl: String) = PlPart(
        partNumber   = f.figNumber,
        blPartNumber = f.figNumber,  // Figure numbers are the BrickLink numbers
        partName     = f.figName ?: f.figNumber,
        colorName    = "Minifiguren",
        colorHex     = "f5a800",
        quantity     = f.totalQuantity?.takeIf { it > 0 } ?: f.quantity,
        imageUrl     = f.imageUrl?.let {
            if (it.startsWith("/")) "${serverUrl}$it" else it
        },
        isFig        = true
    )

    /**
     * "Can I build this?" — the same list with `present` set, or
     * null on an error. [onlyLose] counts only parts that are not stuck in any
     * set (otherwise one would have to take apart a different set); [withSubAccounts]
     * false queries only one's own account.
     */
    override suspend fun withInventory(
        parts: List<PlPart>,
        onlyLose: Boolean,
        withSubAccounts: Boolean,
    ): List<PlPart>? {
        if (parts.isEmpty()) return parts
        // Queried in REBRICKABLE spelling: that is exactly what also stands in
        // the parts table itself. The BrickLink number next to it is there for
        // the export and is not suited for matching.
        val request = parts.map { PartialKey(number = it.partNumber, color = it.colorId) }
        // The view comes from this screen, not from the parts tab's account
        // filter. `null` means "all accounts".
        val response = partsRepo.getOwnedParts(request, if (withSubAccounts) null else AccountSelection.Own)
        val stock = (response as? Outcome.Success)?.data ?: return null
        return parts.map { p ->
            val entry = stock[PartialKey(p.partNumber, p.colorId)]
            p.copy(present = if (entry == null) 0 else if (onlyLose) entry.lose else entry.total)
        }
    }

    override fun sorted(parts: Collection<PlPart>): List<PlPart> = parts.sortedWith { a, b ->
        val cmp = plColorCollator.compare(a.colorName, b.colorName)
        if (cmp != 0) cmp
        else comparePartNumbers(a.blPartNumber ?: a.partNumber, b.blPartNumber ?: b.partNumber)
    }
}
