package ch.brickinventoryapp.data.api

/**
 * Alle Bereiche zusammen. Die App injiziert nur die Bereiche (NetzModule), jedes
 * Repository sieht nur seinen; diese Summe gibt es für Tests, die mit einem
 * Testserver alle Repositories bauen. Je Bereich eine Datei in diesem Ordner;
 * die Vertragsprüfungen des Web lesen den ganzen Ordner.
 */
interface BrickApiService : KontoApi, VerwaltungApi, KatalogApi, SetsApi, TeileApi, FigurenApi,
    HaushaltApi, FinanzenApi, GutscheineApi
