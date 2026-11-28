@file:Suppress("FunctionNaming")

package ch.brickinventoryapp.data.testing

import android.content.Context
import ch.brickinventoryapp.data.NetworkState
import ch.brickinventoryapp.data.NetworkState.RetryPolicy
import ch.brickinventoryapp.data.account.AccountRepositoryImpl
import ch.brickinventoryapp.data.account.HouseholdRepositoryImpl
import ch.brickinventoryapp.data.account.ManagementRepositoryImpl
import ch.brickinventoryapp.data.account.StoreAccountView
import ch.brickinventoryapp.data.api.AccountApi
import ch.brickinventoryapp.data.api.CatalogApi
import ch.brickinventoryapp.data.api.FinancesApi
import ch.brickinventoryapp.data.api.HouseholdApi
import ch.brickinventoryapp.data.api.ManagementApi
import ch.brickinventoryapp.data.api.MinifigsApi
import ch.brickinventoryapp.data.api.PartsApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.VouchersApi
import ch.brickinventoryapp.data.catalog.CatalogRepositoryImpl
import ch.brickinventoryapp.data.catalog.SetCatalogRepositoryImpl
import ch.brickinventoryapp.data.collection.AlarmRepositoryImpl
import ch.brickinventoryapp.data.collection.SetFilesRepositoryImpl
import ch.brickinventoryapp.data.collection.SetsRepositoryImpl
import ch.brickinventoryapp.data.collection.WantedRepositoryImpl
import ch.brickinventoryapp.data.finances.FinancesRepositoryImpl
import ch.brickinventoryapp.data.finances.VouchersRepositoryImpl
import ch.brickinventoryapp.data.local.StoreStockReconciliation
import ch.brickinventoryapp.data.parts.MinifigsRepositoryImpl
import ch.brickinventoryapp.data.parts.PartsRepositoryImpl
import ch.brickinventoryapp.dataapi.account.AccountRepository
import ch.brickinventoryapp.dataapi.account.AccountView
import ch.brickinventoryapp.dataapi.account.HouseholdRepository
import ch.brickinventoryapp.dataapi.account.ManagementRepository
import ch.brickinventoryapp.dataapi.catalog.CatalogRepository
import ch.brickinventoryapp.dataapi.catalog.SetCatalogRepository
import ch.brickinventoryapp.dataapi.collection.AlarmRepository
import ch.brickinventoryapp.dataapi.collection.SetFilesRepository
import ch.brickinventoryapp.dataapi.collection.SetsRepository
import ch.brickinventoryapp.dataapi.collection.WantedRepository
import ch.brickinventoryapp.dataapi.finances.FinancesRepository
import ch.brickinventoryapp.dataapi.finances.VouchersRepository
import ch.brickinventoryapp.dataapi.language.AppLanguage
import ch.brickinventoryapp.dataapi.parts.MinifigsRepository
import ch.brickinventoryapp.dataapi.parts.PartsRepository
import ch.brickinventoryapp.dataapi.stock.StockReconciliation
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.Outbox
import ch.brickinventoryapp.offline.OutboxPlanner
import ch.brickinventoryapp.offline.OutboxStorage
import ch.brickinventoryapp.offline.StorageInventory
import ch.brickinventoryapp.security.TrustCipher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers

// Test defaults don't belong in the @Inject constructors: there, whoever builds without Hilt
// would silently get a transient store. The factories are named like the interfaces; whoever
// needs a store gets their own in memory with no argument given.

/** Lists and outbox in memory, with a fixed scope; the test keeps [outbox] to check on it. */
fun TestStore(area: String? = "test", outbox: Outbox = OutboxStorage(), planner: OutboxPlanner = OutboxPlanner {}) =
    OfflineStore(StorageInventory(), outbox, { area }, planner)

fun testSetsRepository(api: SetsApi, store: OfflineStore = TestStore()): SetsRepository =
    SetsRepositoryImpl(api, store, RetryPolicy.ONCE)

fun testWantedRepository(api: SetsApi, store: OfflineStore = TestStore()): WantedRepository =
    WantedRepositoryImpl(api, store, RetryPolicy.ONCE)

fun testAlarmRepository(api: SetsApi, store: OfflineStore = TestStore()): AlarmRepository =
    AlarmRepositoryImpl(api, store, RetryPolicy.ONCE)

fun testSetCatalogRepository(api: SetsApi): SetCatalogRepository =
    SetCatalogRepositoryImpl(api)

fun testSetFilesRepository(api: SetsApi): SetFilesRepository =
    SetFilesRepositoryImpl(api)

fun testPartsRepository(api: PartsApi, store: OfflineStore = TestStore()): PartsRepository =
    PartsRepositoryImpl(api, store, RetryPolicy.ONCE)

fun testMinifigsRepository(api: MinifigsApi, store: OfflineStore = TestStore()): MinifigsRepository =
    MinifigsRepositoryImpl(api, store, RetryPolicy.ONCE)

fun testVouchersRepository(api: VouchersApi): VouchersRepository =
    VouchersRepositoryImpl(api, TestStore())

fun testAccountRepository(
    api: AccountApi,
    io: CoroutineDispatcher = Dispatchers.IO,
): AccountRepository = AccountRepositoryImpl(api, io)

fun testFinancesRepository(api: FinancesApi, store: OfflineStore = TestStore()): FinancesRepository = FinancesRepositoryImpl(api, store)

fun testHouseholdRepository(api: HouseholdApi, store: OfflineStore = TestStore()): HouseholdRepository =
    HouseholdRepositoryImpl(api, store)

fun testManagementRepository(api: ManagementApi): ManagementRepository =
    ManagementRepositoryImpl(api)

fun testCatalogRepository(api: CatalogApi, store: OfflineStore = TestStore()): CatalogRepository =
    CatalogRepositoryImpl(api, store, RetryPolicy.ONCE)

/** The view over chosen accounts; with the same [store] as the repositories, so writing asks it again. */
fun testAccountView(api: BrickApiService, store: OfflineStore = TestStore()): AccountView =
    StoreAccountView(api, api, api, store, RetryPolicy.ONCE)

/** Sets, parts and figures on one shared [store]. */
fun testStockReconciliation(api: BrickApiService, store: OfflineStore): StockReconciliation =
    StoreStockReconciliation(SetsRepositoryImpl(api, store, RetryPolicy.ONCE), WantedRepositoryImpl(api, store, RetryPolicy.ONCE),
        PartsRepositoryImpl(api, store, RetryPolicy.ONCE),
        MinifigsRepositoryImpl(api, store, RetryPolicy.ONCE), store)

/** The device store's trust cipher with a fixed key: Robolectric has no Keystore. */
fun testTrustCipher(key: Byte = 7): TrustCipher = TrustCipher { ByteArray(32) { key } }

/** A network situation the test sets; the device measures it via the ConnectivityManager. */
fun testNetworkState(kind: () -> NetworkState.Kind): NetworkState = NetworkState(kind)

/** The app language as tests see it: no AppCompat locale switch, texts from the context as given. */
object TestAppLanguage : AppLanguage {
    override fun applyLanguage(languageCode: String) = Unit
    override fun localizedContext(base: Context): Context = base
}
