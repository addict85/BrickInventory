package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Kaufaenderung
import ch.brickinventoryapp.model.fach.Kaufkorrektur
import ch.brickinventoryapp.model.fach.EinladungAnsicht
import ch.brickinventoryapp.model.fach.HaushaltStatusAnsicht
import ch.brickinventoryapp.model.fach.KaeufeAnsicht
import ch.brickinventoryapp.model.fach.MitgliedAnsicht

import ch.brickinventoryapp.model.fach.Zustand
/**
 * Der Haushalt: Mitglieder, Einladungen, Konten.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (HaushaltRepositoryImpl).
 */
interface HaushaltRepository {
    suspend fun getHousehold(): Ergebnis<HaushaltStatusAnsicht>

    suspend fun getHouseholdMembers(): Ergebnis<List<MitgliedAnsicht>>

    suspend fun createHouseholdInvite(): Ergebnis<EinladungAnsicht>

    suspend fun redeemHouseholdInvite(code: String, passwort: String, faktorCode: String? = null): Ergebnis<Unit>

    suspend fun unlinkHousehold(subUserId: Int? = null, mainUserId: Int? = null): Ergebnis<Unit>

    suspend fun verwerfeGetrenntesKonto(subUserId: Int): Ergebnis<Unit>

    suspend fun getAcquisitions(setNumber: String): Ergebnis<KaeufeAnsicht>

    suspend fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double? = null,
                                  condition: Zustand? = null, quantity: Int? = null, date: String? = null,
                                  ownerUserId: Int? = null): Ergebnis<Kaufaenderung>

    suspend fun deleteAcquisition(setNumber: String, acqId: Int): Ergebnis<Kaufaenderung>

    suspend fun getPartAcquisitions(partNumber: String, colorId: Int): Ergebnis<KaeufeAnsicht>

    suspend fun updatePartAcquisition(partNumber: String, colorId: Int, id: Int, korrektur: Kaufkorrektur): Ergebnis<Kaufaenderung>

    suspend fun deletePartAcquisition(partNumber: String, colorId: Int, id: Int): Ergebnis<Unit>

    suspend fun getFigAcquisitions(figNumber: String): Ergebnis<KaeufeAnsicht>

    suspend fun updateFigAcquisition(figNumber: String, id: Int, korrektur: Kaufkorrektur): Ergebnis<Kaufaenderung>

    suspend fun deleteFigAcquisition(figNumber: String, id: Int): Ergebnis<Unit>
}
