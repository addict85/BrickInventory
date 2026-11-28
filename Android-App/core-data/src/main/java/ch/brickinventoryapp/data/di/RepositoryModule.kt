package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.data.account.AccountDataDeleter
import ch.brickinventoryapp.data.account.AccountDataDeletion
import ch.brickinventoryapp.data.account.AccountRepository
import ch.brickinventoryapp.data.account.AccountRepositoryImpl
import ch.brickinventoryapp.data.account.HouseholdRepository
import ch.brickinventoryapp.data.account.HouseholdRepositoryImpl
import ch.brickinventoryapp.data.account.ManagementRepository
import ch.brickinventoryapp.data.account.ManagementRepositoryImpl
import ch.brickinventoryapp.data.account.StepBindingImpl
import ch.brickinventoryapp.data.catalog.CatalogRepository
import ch.brickinventoryapp.data.catalog.CatalogRepositoryImpl
import ch.brickinventoryapp.data.catalog.SetCatalogRepository
import ch.brickinventoryapp.data.catalog.SetCatalogRepositoryImpl
import ch.brickinventoryapp.data.collection.AlarmRepository
import ch.brickinventoryapp.data.collection.AlarmRepositoryImpl
import ch.brickinventoryapp.data.collection.SetFilesRepository
import ch.brickinventoryapp.data.collection.SetFilesRepositoryImpl
import ch.brickinventoryapp.data.collection.SetsRepository
import ch.brickinventoryapp.data.collection.SetsRepositoryImpl
import ch.brickinventoryapp.data.collection.WantedRepository
import ch.brickinventoryapp.data.collection.WantedRepositoryImpl
import ch.brickinventoryapp.data.finances.FinancesRepository
import ch.brickinventoryapp.data.finances.FinancesRepositoryImpl
import ch.brickinventoryapp.data.finances.VouchersRepository
import ch.brickinventoryapp.data.finances.VouchersRepositoryImpl
import ch.brickinventoryapp.data.local.StoreStockReconciliation
import ch.brickinventoryapp.data.parts.MinifigsRepository
import ch.brickinventoryapp.data.parts.MinifigsRepositoryImpl
import ch.brickinventoryapp.data.parts.PartsRepository
import ch.brickinventoryapp.data.parts.PartsRepositoryImpl
import ch.brickinventoryapp.data.stock.StockReconciliation
import ch.brickinventoryapp.model.step.StepBinding
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** The repositories as interfaces; whoever needs one does not see the implementation. */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class RepositoryModule {
    @Binds abstract fun sets(r: SetsRepositoryImpl): SetsRepository
    @Binds abstract fun wanted(r: WantedRepositoryImpl): WantedRepository
    @Binds abstract fun priceAlarms(r: AlarmRepositoryImpl): AlarmRepository
    @Binds abstract fun setCatalog(r: SetCatalogRepositoryImpl): SetCatalogRepository
    @Binds abstract fun setFiles(r: SetFilesRepositoryImpl): SetFilesRepository
    @Binds abstract fun parts(r: PartsRepositoryImpl): PartsRepository
    @Binds abstract fun finances(r: FinancesRepositoryImpl): FinancesRepository
    @Binds abstract fun minifigs(r: MinifigsRepositoryImpl): MinifigsRepository
    @Binds abstract fun household(r: HouseholdRepositoryImpl): HouseholdRepository
    @Binds abstract fun account(r: AccountRepositoryImpl): AccountRepository
    @Binds abstract fun management(r: ManagementRepositoryImpl): ManagementRepository
    @Binds abstract fun catalog(r: CatalogRepositoryImpl): CatalogRepository
    @Binds abstract fun vouchers(r: VouchersRepositoryImpl): VouchersRepository
    @Binds abstract fun accountData(l: AccountDataDeletion): AccountDataDeleter
    @Binds abstract fun stepBinding(s: StepBindingImpl): StepBinding
    @Binds abstract fun stock(s: StoreStockReconciliation): StockReconciliation
}
