package ch.brickinventoryapp.dataapi.account

import ch.brickinventoryapp.model.data.SparePartChoice
import ch.brickinventoryapp.model.domain.AccountSelection
import ch.brickinventoryapp.model.domain.CategoryChoice
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.FigureView
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.PartView
import ch.brickinventoryapp.model.domain.SetSort
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.model.domain.WantedSort
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.model.outcome.Outcome
import kotlinx.coroutines.flow.Flow

/**
 * The view over selected accounts, storage locations or with „In Sets“: quantities and prices
 * per account are split only by the server. An interface so the screens see the queries and
 * lists, not the store and APIs that fill them.
 */
interface AccountView {
    /** A list only the server fills for [A]; it follows changes in the store by itself. */
    interface ServerView<A, T> {
        /** Never loaded means state null, as in the store; a response for a different account does not count. */
        fun observe(query: A): Flow<Local<T>>
        suspend fun refresh(query: A): Outcome<Unit>
    }

    data class SetsQuery(val accounts: AccountSelection?, val search: String?, val theme: String?,
                           val sort: SetSort?, val storageLocation: String?)
    data class RememberQuery(val accounts: AccountSelection, val search: String?, val condition: Condition?, val sort: WantedSort?)
    data class PartsQuery(val accounts: AccountSelection?, val search: String?, val color: ColorPicker, val category: CategoryChoice,
                            val spareParts: SparePartChoice, val withSets: Boolean, val storageLocation: String?)
    data class ManualQuery(val accounts: AccountSelection?, val search: String?, val storageLocation: String?)
    data class MinifigsQuery(val accounts: AccountSelection, val search: String?)

    val gallery: ServerView<SetsQuery, SetView>
    val wantedList: ServerView<RememberQuery, WantedItemView>
    val partList: ServerView<PartsQuery, PartView>
    val manualParts: ServerView<ManualQuery, ManualPartView>
    val figureList: ServerView<MinifigsQuery, FigureView>
    val manualMinifigs: ServerView<MinifigsQuery, ManualMinifigView>
}
