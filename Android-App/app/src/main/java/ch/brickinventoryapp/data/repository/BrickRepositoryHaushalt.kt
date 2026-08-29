package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.decodeFromString
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Haushalt und Erfassungen.
 *
 * ── Warum eigene Datei (Nachtrag 155) ───────────────────────────────────────
 *
 * BrickRepository hatte 78 oeffentliche Funktionen in 519 Zeilen und war damit
 * die Anlaufstelle fuer alles zugleich. Die Funktionen sind hier als
 * ERWEITERUNGSFUNKTIONEN abgelegt, nach Sachgebiet getrennt.
 *
 * Fuer Aufrufer aendert sich nichts: `repo.createHouseholdInvite(...)` loest
 * genauso auf wie zuvor. Die Ruempfe sind WORTGLEICH uebernommen; veraendert
 * wurde nur die Einrueckung und der Empfaenger in der Signatur.
 *
 * Die Begruendung fuer Erweiterungen statt Schnittstellen-Delegation steht in
 * BrickRepository.kt.
 */

suspend fun BrickRepository.getAcquisitions(setNumber: String): Result<AcquisitionsResponse> =
    safeCall { api.getAcquisitions(setNumber) }

suspend fun BrickRepository.updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double? = null,
                              condition: String? = null, quantity: Int? = null, date: String? = null,
                              ownerUserId: Int? = null): Result<GenericResponse> =
    safeCall { api.updateAcquisition(setNumber, acqId,
        // fuerSet(): Sets tragen den Preis als `purchase_price` — siehe die
        // Erklärung am Modell (Nachtrag 111).
        UpdateAcquisitionRequest.fuerSet(purchasePrice, condition, quantity, date, ownerUserId)) }

suspend fun BrickRepository.deleteAcquisition(setNumber: String, acqId: Int): Result<GenericResponse> =
    safeCall { api.deleteAcquisition(setNumber, acqId) }

// Parts acquisitions
// ── Haushalt ──────────────────────────────────────────────────────────────
suspend fun BrickRepository.getHousehold(): Result<HouseholdStatusResponse> =
    safeCall { api.getHousehold() }

suspend fun BrickRepository.getHouseholdMembers(): Result<HouseholdMembersResponse> =
    safeCall { api.getHouseholdMembers() }

suspend fun BrickRepository.createHouseholdInvite(): Result<HouseholdInviteResponse> =
    safeCall { api.createHouseholdInvite() }

suspend fun BrickRepository.redeemHouseholdInvite(code: String): Result<GenericResponse> =
    safeCall { api.redeemHouseholdInvite(mapOf("code" to code)) }

/** subUserId leer = die eigene Verknüpfung lösen (als Unterkonto). */
suspend fun BrickRepository.unlinkHousehold(subUserId: Int? = null): Result<GenericResponse> =
    safeCall { api.unlinkHousehold(subUserId?.let { mapOf("sub_user_id" to it) } ?: emptyMap()) }

suspend fun BrickRepository.getPartAcquisitions(partNumber: String, colorId: Int): Result<AcquisitionsResponse> =
    safeCall { api.getPartAcquisitions(partNumber, colorId) }

suspend fun BrickRepository.updatePartAcquisition(partNumber: String, colorId: Int, id: Int, req: UpdateAcquisitionRequest): Result<GenericResponse> =
    safeCall { api.updatePartAcquisition(partNumber, colorId, id, req) }

suspend fun BrickRepository.deletePartAcquisition(partNumber: String, colorId: Int, id: Int): Result<DeleteWithQuantityResponse> =
    safeCall { api.deletePartAcquisition(partNumber, colorId, id) }

// Minifig acquisitions
suspend fun BrickRepository.getFigAcquisitions(figNumber: String): Result<AcquisitionsResponse> =
    safeCall { api.getFigAcquisitions(figNumber) }

suspend fun BrickRepository.updateFigAcquisition(figNumber: String, id: Int, req: UpdateAcquisitionRequest): Result<GenericResponse> =
    safeCall { api.updateFigAcquisition(figNumber, id, req) }

suspend fun BrickRepository.deleteFigAcquisition(figNumber: String, id: Int): Result<DeleteWithQuantityResponse> =
    safeCall { api.deleteFigAcquisition(figNumber, id) }
