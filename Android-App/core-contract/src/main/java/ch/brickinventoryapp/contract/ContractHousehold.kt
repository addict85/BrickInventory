// Generated from Web-App/docs/openapi-v2.json by Web-App/scripts/contract-kotlin-dtos.js.
// Do not edit by hand: npm run contract:kotlin (in the Web-App folder).
@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList")

package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.CurrencyCode
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class HouseholdInviteCheckResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("inviter") val inviter: HouseholdInviteCheckResponseInviter,
)

@Serializable
data class HouseholdInviteCheckResponseInviter(
    @SerialName("id") val id: Int,
    @SerialName("username") val username: String,
)

@Serializable
data class HouseholdInviteResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("code") val code: String?,
    @SerialName("expires_in") val expiresIn: Int?,
)

@Serializable
data class HouseholdMember(
    @SerialName("depth") val depth: Int,
    @SerialName("id") val id: Int,
    @SerialName("username") val username: String,
    @SerialName("is_self") val isSelf: Boolean,
)

@Serializable
data class HouseholdMembersResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("members") val members: List<HouseholdMember>,
)

@Serializable
data class HouseholdStatusResponse(
    @SerialName("view") val view: List<HouseholdMember>,
    @SerialName("success") val success: Boolean,
    @SerialName("is_main") val isMain: Boolean,
    @SerialName("is_sub") val isSub: Boolean,
    @SerialName("currency") val currency: CurrencyCode,
    @SerialName("linked_to") val linkedTo: AccountName?,
    @SerialName("parents") val parents: List<AccountName>,
    @SerialName("sub_accounts") val subAccounts: List<HouseholdMember>,
    @SerialName("open_invites") val openInvites: Int,
    @SerialName("former_links") val formerLinks: List<SeparatedAccount>,
    @SerialName("degraded") val degraded: List<String> = emptyList(),
)

@Serializable
data class SeparatedAccount(
    @SerialName("id") val id: Int,
    @SerialName("username") val username: String,
    @SerialName("via") val via: String?,
)
