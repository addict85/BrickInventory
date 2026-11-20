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
 * Alle Bereiche zusammen, nur für Tests: Ein Testserver baut damit jedes
 * Repository. Die App injiziert je Bereich eine Schnittstelle (NetzModule), damit
 * kein Repository mehr sieht als seinen Bereich.
 */
interface BrickApiService : AccountApi, ManagementApi, CatalogApi, SetsApi, PartsApi, MinifigsApi,
    HouseholdApi, FinancesApi, VouchersApi
