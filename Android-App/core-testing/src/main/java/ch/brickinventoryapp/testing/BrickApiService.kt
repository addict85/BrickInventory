package ch.brickinventoryapp.testing

import ch.brickinventoryapp.data.api.MinifigsApi
import ch.brickinventoryapp.data.api.FinancesApi
import ch.brickinventoryapp.data.api.VouchersApi
import ch.brickinventoryapp.data.api.HouseholdApi
import ch.brickinventoryapp.data.api.CatalogApi
import ch.brickinventoryapp.data.api.AccountApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.PartsApi
import ch.brickinventoryapp.data.api.ManagementApi

/**
 * All scopes together, for tests only: a test server builds every
 * repository with it. The app injects an interface per scope (NetworkModule), so
 * no repository sees more than its own scope.
 */
interface BrickApiService : AccountApi, ManagementApi, CatalogApi, SetsApi, PartsApi, MinifigsApi,
    HouseholdApi, FinancesApi, VouchersApi
