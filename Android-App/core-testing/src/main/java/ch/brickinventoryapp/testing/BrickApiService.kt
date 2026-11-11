package ch.brickinventoryapp.testing

import ch.brickinventoryapp.data.api.FigurenApi
import ch.brickinventoryapp.data.api.FinanzenApi
import ch.brickinventoryapp.data.api.GutscheineApi
import ch.brickinventoryapp.data.api.HaushaltApi
import ch.brickinventoryapp.data.api.KatalogApi
import ch.brickinventoryapp.data.api.KontoApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.TeileApi
import ch.brickinventoryapp.data.api.VerwaltungApi

/**
 * Alle Bereiche zusammen, nur für Tests: Ein Testserver baut damit jedes
 * Repository. Die App injiziert je Bereich eine Schnittstelle (NetzModule), damit
 * kein Repository mehr sieht als seinen Bereich.
 */
interface BrickApiService : KontoApi, VerwaltungApi, KatalogApi, SetsApi, TeileApi, FigurenApi,
    HaushaltApi, FinanzenApi, GutscheineApi
