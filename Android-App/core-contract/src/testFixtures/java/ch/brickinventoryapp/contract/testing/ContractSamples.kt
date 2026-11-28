// Generated from Web-App/docs/openapi-v2.json by Web-App/scripts/contract-kotlin-dtos.js.
// Do not edit by hand: npm run contract:kotlin (in the Web-App folder).
@file:Suppress("FunctionNaming", "LongParameterList")

package ch.brickinventoryapp.contract.testing

import ch.brickinventoryapp.contract.AccountActive
import ch.brickinventoryapp.contract.AccountInList
import ch.brickinventoryapp.contract.AccountInListAnnouncedEntry
import ch.brickinventoryapp.contract.AccountList
import ch.brickinventoryapp.contract.AccountName
import ch.brickinventoryapp.contract.Acquisition
import ch.brickinventoryapp.contract.AcquisitionTotals
import ch.brickinventoryapp.contract.AcquisitionsResponse
import ch.brickinventoryapp.contract.AddMinifigResponse
import ch.brickinventoryapp.contract.AddPartResponse
import ch.brickinventoryapp.contract.AddSetResponse
import ch.brickinventoryapp.contract.ApiLimits
import ch.brickinventoryapp.contract.ApiLimitsResponse
import ch.brickinventoryapp.contract.AppThemeResponse
import ch.brickinventoryapp.contract.AppToken
import ch.brickinventoryapp.contract.Backup
import ch.brickinventoryapp.contract.BackupRestored
import ch.brickinventoryapp.contract.BalanceReply
import ch.brickinventoryapp.contract.BarcodeResponse
import ch.brickinventoryapp.contract.BlColorTable
import ch.brickinventoryapp.contract.BrickColor
import ch.brickinventoryapp.contract.BrickColorsResponse
import ch.brickinventoryapp.contract.BrickLinkRef
import ch.brickinventoryapp.contract.BricklinkLinks
import ch.brickinventoryapp.contract.BricksetQueueEntry
import ch.brickinventoryapp.contract.BricksetQueueResponse
import ch.brickinventoryapp.contract.CacheStatsResponse
import ch.brickinventoryapp.contract.CacheTtlResponse
import ch.brickinventoryapp.contract.CatalogMetaResponse
import ch.brickinventoryapp.contract.CatalogSetDetail
import ch.brickinventoryapp.contract.CatalogSetDetailResponse
import ch.brickinventoryapp.contract.CatalogSetItem
import ch.brickinventoryapp.contract.CatalogSetsResponse
import ch.brickinventoryapp.contract.CatalogTheme
import ch.brickinventoryapp.contract.CatalogYearCount
import ch.brickinventoryapp.contract.CatalogYearDistributionResponse
import ch.brickinventoryapp.contract.ChartPoint
import ch.brickinventoryapp.contract.ChartYAxis
import ch.brickinventoryapp.contract.ComponentHeader
import ch.brickinventoryapp.contract.ConditionValuation
import ch.brickinventoryapp.contract.CsvImportResult
import ch.brickinventoryapp.contract.CsvImportRow
import ch.brickinventoryapp.contract.CsvImportStatus
import ch.brickinventoryapp.contract.CurrentByCondition
import ch.brickinventoryapp.contract.CurrentPrice
import ch.brickinventoryapp.contract.DashboardStats
import ch.brickinventoryapp.contract.DefaultConditionResponse
import ch.brickinventoryapp.contract.DeleteWithQuantityResponse
import ch.brickinventoryapp.contract.Deleted
import ch.brickinventoryapp.contract.Done
import ch.brickinventoryapp.contract.EmailPreview
import ch.brickinventoryapp.contract.Endpoints
import ch.brickinventoryapp.contract.ErrorResponse
import ch.brickinventoryapp.contract.FigValuationItem
import ch.brickinventoryapp.contract.FigsValuationResponse
import ch.brickinventoryapp.contract.ForgotPasswordResponse
import ch.brickinventoryapp.contract.GenericAdminResponse
import ch.brickinventoryapp.contract.GenericResponse
import ch.brickinventoryapp.contract.Health
import ch.brickinventoryapp.contract.Heartbeat
import ch.brickinventoryapp.contract.HoldingCleared
import ch.brickinventoryapp.contract.HoldingEntry
import ch.brickinventoryapp.contract.HoldingResponse
import ch.brickinventoryapp.contract.HouseholdInviteCheckResponse
import ch.brickinventoryapp.contract.HouseholdInviteCheckResponseInviter
import ch.brickinventoryapp.contract.HouseholdInviteResponse
import ch.brickinventoryapp.contract.HouseholdMember
import ch.brickinventoryapp.contract.HouseholdMembersResponse
import ch.brickinventoryapp.contract.HouseholdStatusResponse
import ch.brickinventoryapp.contract.ImageDiagnosis
import ch.brickinventoryapp.contract.ImageDiagnosisDatabase
import ch.brickinventoryapp.contract.ImageDiagnosisLocal
import ch.brickinventoryapp.contract.ImageDiagnosisLocalOriginal
import ch.brickinventoryapp.contract.ImageDiagnosisLocalPreview
import ch.brickinventoryapp.contract.ImageDiagnosisMarker
import ch.brickinventoryapp.contract.ImageDiagnosisProxy
import ch.brickinventoryapp.contract.ImageMarkerForgotten
import ch.brickinventoryapp.contract.Instruction
import ch.brickinventoryapp.contract.InstructionUploadedInstruction
import ch.brickinventoryapp.contract.InstructionsLoaded
import ch.brickinventoryapp.contract.Job
import ch.brickinventoryapp.contract.JobChange
import ch.brickinventoryapp.contract.JobCounter
import ch.brickinventoryapp.contract.JobKindDrain
import ch.brickinventoryapp.contract.JobKindStart
import ch.brickinventoryapp.contract.JobPause
import ch.brickinventoryapp.contract.JobProcess
import ch.brickinventoryapp.contract.JobProgress
import ch.brickinventoryapp.contract.JobQueueResponse
import ch.brickinventoryapp.contract.JobSchedule
import ch.brickinventoryapp.contract.JobStatus
import ch.brickinventoryapp.contract.JobStatusSubPartsEntry
import ch.brickinventoryapp.contract.JobsResponse
import ch.brickinventoryapp.contract.JobsResponseProxyHint
import ch.brickinventoryapp.contract.JobsResponseProxyHintVars
import ch.brickinventoryapp.contract.KeyNonceResponse
import ch.brickinventoryapp.contract.LogEntries
import ch.brickinventoryapp.contract.LogResponse
import ch.brickinventoryapp.contract.LogRow
import ch.brickinventoryapp.contract.LoginResponse
import ch.brickinventoryapp.contract.ManualFigsResponse
import ch.brickinventoryapp.contract.ManualPartsResponse
import ch.brickinventoryapp.contract.MeResponse
import ch.brickinventoryapp.contract.Minifig
import ch.brickinventoryapp.contract.MinifigParts
import ch.brickinventoryapp.contract.MinifigStats
import ch.brickinventoryapp.contract.MinifigStatsResponse
import ch.brickinventoryapp.contract.MinifigsResponse
import ch.brickinventoryapp.contract.MoveSetResponse
import ch.brickinventoryapp.contract.OthersEnded
import ch.brickinventoryapp.contract.ParsedVoucher
import ch.brickinventoryapp.contract.Part
import ch.brickinventoryapp.contract.PartColorResponse
import ch.brickinventoryapp.contract.PartValuationItem
import ch.brickinventoryapp.contract.PartsCategoriesResponse
import ch.brickinventoryapp.contract.PartsCategory
import ch.brickinventoryapp.contract.PartsFilterColor
import ch.brickinventoryapp.contract.PartsFilterColorsResponse
import ch.brickinventoryapp.contract.PartsLoaded
import ch.brickinventoryapp.contract.PartsResponse
import ch.brickinventoryapp.contract.PartsStats
import ch.brickinventoryapp.contract.PartsStatsResponse
import ch.brickinventoryapp.contract.PartsValuationResponse
import ch.brickinventoryapp.contract.Passkey
import ch.brickinventoryapp.contract.PasskeyCreated
import ch.brickinventoryapp.contract.PasskeyCreatedPasskey
import ch.brickinventoryapp.contract.PasskeyList
import ch.brickinventoryapp.contract.PasskeyOptions
import ch.brickinventoryapp.contract.PasswordSet
import ch.brickinventoryapp.contract.PdfInputPartsEntry
import ch.brickinventoryapp.contract.PdfInputSetsEntry
import ch.brickinventoryapp.contract.PdfJobResponse
import ch.brickinventoryapp.contract.PdfJobState
import ch.brickinventoryapp.contract.PendingAlertsResponse
import ch.brickinventoryapp.contract.PnlResponse
import ch.brickinventoryapp.contract.PnlSetRow
import ch.brickinventoryapp.contract.PnlTotals
import ch.brickinventoryapp.contract.PortfolioHistoryResponse
import ch.brickinventoryapp.contract.PriceAlert
import ch.brickinventoryapp.contract.PriceAlertResponse
import ch.brickinventoryapp.contract.PriceAlertsResponse
import ch.brickinventoryapp.contract.PriceByCondition
import ch.brickinventoryapp.contract.PriceChartData
import ch.brickinventoryapp.contract.PriceChartPoint
import ch.brickinventoryapp.contract.PriceChartSeries
import ch.brickinventoryapp.contract.PriceHistoryPoint
import ch.brickinventoryapp.contract.PriceHistoryResponse
import ch.brickinventoryapp.contract.PriceJobState
import ch.brickinventoryapp.contract.PriceJobStateJob
import ch.brickinventoryapp.contract.PriceJobStateJobProgress
import ch.brickinventoryapp.contract.PriceJobStateRateLimit
import ch.brickinventoryapp.contract.Profile
import ch.brickinventoryapp.contract.ProfileResponse
import ch.brickinventoryapp.contract.ProfileSavedResponse
import ch.brickinventoryapp.contract.QrMessage
import ch.brickinventoryapp.contract.QrPairingState
import ch.brickinventoryapp.contract.QrPickup
import ch.brickinventoryapp.contract.QrToken
import ch.brickinventoryapp.contract.QuantityChanged
import ch.brickinventoryapp.contract.QuantityChangedDroppedEntry
import ch.brickinventoryapp.contract.RateLimit
import ch.brickinventoryapp.contract.RateLimits
import ch.brickinventoryapp.contract.RawSettings
import ch.brickinventoryapp.contract.RegisterResponse
import ch.brickinventoryapp.contract.RegistrationStatusResponse
import ch.brickinventoryapp.contract.Restored
import ch.brickinventoryapp.contract.SecondFactorCodes
import ch.brickinventoryapp.contract.SecondFactorSetupResponse
import ch.brickinventoryapp.contract.SecondFactorStateResponse
import ch.brickinventoryapp.contract.SeparatedAccount
import ch.brickinventoryapp.contract.SetAggregate
import ch.brickinventoryapp.contract.SetExistsResponse
import ch.brickinventoryapp.contract.SetInfoResponse
import ch.brickinventoryapp.contract.SetItem
import ch.brickinventoryapp.contract.SetPriceResponse
import ch.brickinventoryapp.contract.SetResponse
import ch.brickinventoryapp.contract.SetsResponse
import ch.brickinventoryapp.contract.SettingsResponse
import ch.brickinventoryapp.contract.Setup
import ch.brickinventoryapp.contract.SetupSources
import ch.brickinventoryapp.contract.SetupState
import ch.brickinventoryapp.contract.SetupStateCa
import ch.brickinventoryapp.contract.SetupStateStepsEntry
import ch.brickinventoryapp.contract.SmtpProbe
import ch.brickinventoryapp.contract.StartupStatus
import ch.brickinventoryapp.contract.StatsResponse
import ch.brickinventoryapp.contract.StepApprovalResponse
import ch.brickinventoryapp.contract.StepChallengeResponse
import ch.brickinventoryapp.contract.Storage
import ch.brickinventoryapp.contract.StorageDefaultResponse
import ch.brickinventoryapp.contract.StorageEntry
import ch.brickinventoryapp.contract.StorageEntryResponse
import ch.brickinventoryapp.contract.StorageResponse
import ch.brickinventoryapp.contract.StorageStockResponse
import ch.brickinventoryapp.contract.StoragesResponse
import ch.brickinventoryapp.contract.TlsState
import ch.brickinventoryapp.contract.TokenCreated
import ch.brickinventoryapp.contract.TokenInfo
import ch.brickinventoryapp.contract.TokenRevocation
import ch.brickinventoryapp.contract.TokenRotation
import ch.brickinventoryapp.contract.TokensResponse
import ch.brickinventoryapp.contract.Totals
import ch.brickinventoryapp.contract.Trash
import ch.brickinventoryapp.contract.TrashEmptied
import ch.brickinventoryapp.contract.TrashEntry
import ch.brickinventoryapp.contract.User
import ch.brickinventoryapp.contract.UserSettings
import ch.brickinventoryapp.contract.UsingSet
import ch.brickinventoryapp.contract.UsingSetsResponse
import ch.brickinventoryapp.contract.ValuationAcquisition
import ch.brickinventoryapp.contract.ValuationResponse
import ch.brickinventoryapp.contract.ValuationSet
import ch.brickinventoryapp.contract.Voucher
import ch.brickinventoryapp.contract.VoucherBatch
import ch.brickinventoryapp.contract.VoucherList
import ch.brickinventoryapp.contract.VoucherPdfGrant
import ch.brickinventoryapp.contract.VoucherPlaintext
import ch.brickinventoryapp.contract.VoucherReply
import ch.brickinventoryapp.contract.WantedItem
import ch.brickinventoryapp.contract.WantedItemAlert
import ch.brickinventoryapp.contract.WantedItemOwnerReply
import ch.brickinventoryapp.contract.WantedItemPricesResponse
import ch.brickinventoryapp.contract.WantedItemReply
import ch.brickinventoryapp.contract.WantedItemTakeoverResponse
import ch.brickinventoryapp.contract.WantedListResponse
import ch.brickinventoryapp.contract.WantedXmlResult
import ch.brickinventoryapp.contract.WantedXmlResultCorrections
import ch.brickinventoryapp.contract.WantedXmlResultItemsEntry
import ch.brickinventoryapp.contract.WantedXmlResultOpenEntry
import ch.brickinventoryapp.contract.WantedXmlResultRebrickable
import ch.brickinventoryapp.contract.YearCount
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.RunStatus
import ch.brickinventoryapp.model.ui.theme.Design
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

fun testAccountActive(
    success: Boolean = false,
    isActive: Boolean = false,
    effectiveAt: String = "",
): AccountActive = AccountActive(
    success = success,
    isActive = isActive,
    effectiveAt = effectiveAt,
)

fun testAccountInList(
    id: Int = 0,
    username: String = "",
    isAdmin: Boolean = false,
    isActive: Boolean = false,
    createdAt: String? = null,
    secondFactor: Boolean = false,
    awaitingConfirmation: Boolean = false,
    announced: List<AccountInListAnnouncedEntry> = emptyList(),
): AccountInList = AccountInList(
    id = id,
    username = username,
    isAdmin = isAdmin,
    isActive = isActive,
    createdAt = createdAt,
    secondFactor = secondFactor,
    awaitingConfirmation = awaitingConfirmation,
    announced = announced,
)

fun testAccountInListAnnouncedEntry(
    type: String = "",
    effectiveAt: String = "",
): AccountInListAnnouncedEntry = AccountInListAnnouncedEntry(
    type = type,
    effectiveAt = effectiveAt,
)

fun testAccountList(
    success: Boolean = false,
    users: List<AccountInList> = emptyList(),
): AccountList = AccountList(
    success = success,
    users = users,
)

fun testAccountName(
    id: Int = 0,
    username: String = "",
): AccountName = AccountName(
    id = id,
    username = username,
)

fun testAcquisition(
    id: Int = 0,
    quantity: Int = 0,
    purchasePrice: Double? = null,
    unitPrice: Double? = null,
    condition: Condition = Condition.NEW,
    createdAt: String? = null,
    ownerUserId: Int = 0,
    priceEstimated: Boolean = false,
    currency: CurrencyCode? = null,
    accountPrice: Double? = null,
): Acquisition = Acquisition(
    id = id,
    quantity = quantity,
    purchasePrice = purchasePrice,
    unitPrice = unitPrice,
    condition = condition,
    createdAt = createdAt,
    ownerUserId = ownerUserId,
    priceEstimated = priceEstimated,
    currency = currency,
    accountPrice = accountPrice,
)

fun testAcquisitionTotals(
    quantity: Int = 0,
    amount: Double? = null,
    pricedRows: Int = 0,
    currency: String = "",
    withoutRate: Int = 0,
): AcquisitionTotals = AcquisitionTotals(
    quantity = quantity,
    amount = amount,
    pricedRows = pricedRows,
    currency = currency,
    withoutRate = withoutRate,
)

fun testAcquisitionsResponse(
    success: Boolean = false,
    ownerUserId: Int = 0,
    acquisitions: List<Acquisition> = emptyList(),
    totals: AcquisitionTotals = testAcquisitionTotals(),
    degraded: List<String> = emptyList(),
): AcquisitionsResponse = AcquisitionsResponse(
    success = success,
    ownerUserId = ownerUserId,
    acquisitions = acquisitions,
    totals = totals,
    degraded = degraded,
)

fun testAddMinifigResponse(
    success: Boolean = false,
    action: String = "",
    figNumber: String = "",
    figName: String? = null,
    priceFromCondition: Condition? = null,
): AddMinifigResponse = AddMinifigResponse(
    success = success,
    action = action,
    figNumber = figNumber,
    figName = figName,
    priceFromCondition = priceFromCondition,
)

fun testAddPartResponse(
    success: Boolean = false,
    action: String = "",
    partNumber: String = "",
    partName: String? = null,
    priceFromCondition: Condition? = null,
): AddPartResponse = AddPartResponse(
    success = success,
    action = action,
    partNumber = partNumber,
    partName = partName,
    priceFromCondition = priceFromCondition,
)

fun testAddSetResponse(
    success: Boolean = false,
    action: String = "",
    setNumber: String = "",
    name: String? = null,
    catalogPending: Boolean = false,
    supplement: String? = null,
    ownerUserId: Int = 0,
    isSelf: Boolean = false,
): AddSetResponse = AddSetResponse(
    success = success,
    action = action,
    setNumber = setNumber,
    name = name,
    catalogPending = catalogPending,
    supplement = supplement,
    ownerUserId = ownerUserId,
    isSelf = isSelf,
)

fun testApiLimits(
    rebrickable: Int = 0,
    bricklink: Int = 0,
    brickset: Int = 0,
): ApiLimits = ApiLimits(
    rebrickable = rebrickable,
    bricklink = bricklink,
    brickset = brickset,
)

fun testApiLimitsResponse(
    success: Boolean = false,
    limits: ApiLimits = testApiLimits(),
): ApiLimitsResponse = ApiLimitsResponse(
    success = success,
    limits = limits,
)

fun testAppThemeResponse(
    success: Boolean = false,
    theme: Design? = null,
    preset: Design? = null,
    own: Design? = null,
): AppThemeResponse = AppThemeResponse(
    success = success,
    theme = theme,
    preset = preset,
    own = own,
)

fun testAppToken(
    tokenId: String = "",
    label: String? = null,
    createdAt: String? = null,
    lastUsed: String? = null,
    expiresAt: String? = null,
    neverExpires: Boolean = false,
    current: Boolean = false,
    tokenPrefix: String? = null,
    hardExpiresAt: String? = null,
    scope: String = "",
    ipRange: String? = null,
    rotatedAt: String = "",
): AppToken = AppToken(
    tokenId = tokenId,
    label = label,
    createdAt = createdAt,
    lastUsed = lastUsed,
    expiresAt = expiresAt,
    neverExpires = neverExpires,
    current = current,
    tokenPrefix = tokenPrefix,
    hardExpiresAt = hardExpiresAt,
    scope = scope,
    ipRange = ipRange,
    rotatedAt = rotatedAt,
)

fun testBackup(
    version: String = "",
    exportedAt: String = "",
    exportedBy: String? = null,
    global: Map<String, String> = emptyMap(),
    userSettings: Map<String, String> = emptyMap(),
): Backup = Backup(
    version = version,
    exportedAt = exportedAt,
    exportedBy = exportedBy,
    global = global,
    userSettings = userSettings,
)

fun testBackupRestored(
    success: Boolean = false,
    imported: Int = 0,
    note: String = "",
    smtpSkipped: List<String> = emptyList(),
): BackupRestored = BackupRestored(
    success = success,
    imported = imported,
    note = note,
    smtpSkipped = smtpSkipped,
)

fun testBalanceReply(
    success: Boolean = false,
    voucher: Voucher? = null,
    displayed: String? = null,
    currencyChanged: Boolean = false,
    removed: Boolean = false,
    reason: String? = null,
    waitSeconds: Int? = null,
    error: String? = null,
    code: String? = null,
): BalanceReply = BalanceReply(
    success = success,
    voucher = voucher,
    displayed = displayed,
    currencyChanged = currencyChanged,
    removed = removed,
    reason = reason,
    waitSeconds = waitSeconds,
    error = error,
    code = code,
)

fun testBarcodeResponse(
    success: Boolean = false,
    setNumber: String = "",
    name: String? = null,
    year: Int? = null,
    pieces: Int? = null,
    theme: String? = null,
    minifigs: Int? = null,
    imageUrl: String? = null,
    imageLocal: String? = null,
    source: String? = null,
    uncertain: Boolean = false,
): BarcodeResponse = BarcodeResponse(
    success = success,
    setNumber = setNumber,
    name = name,
    year = year,
    pieces = pieces,
    theme = theme,
    minifigs = minifigs,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    source = source,
    uncertain = uncertain,
)

fun testBlColorTable(
    success: Boolean = false,
    source: String = "",
    map: JsonObject = JsonObject(emptyMap()),
    degraded: List<String> = emptyList(),
): BlColorTable = BlColorTable(
    success = success,
    source = source,
    map = map,
    degraded = degraded,
)

fun testBrickColor(
    id: Int = 0,
    name: String = "",
    hex: String? = null,
): BrickColor = BrickColor(
    id = id,
    name = name,
    hex = hex,
)

fun testBrickColorsResponse(
    success: Boolean = false,
    colors: List<BrickColor> = emptyList(),
): BrickColorsResponse = BrickColorsResponse(
    success = success,
    colors = colors,
)

fun testBrickLinkRef(
    type: String = "",
    number: String = "",
    url: String? = null,
    exact: Boolean = false,
    resolved: Boolean = false,
): BrickLinkRef = BrickLinkRef(
    type = type,
    number = number,
    url = url,
    exact = exact,
    resolved = resolved,
)

fun testBricklinkLinks(
    success: Boolean = false,
    links: JsonObject = JsonObject(emptyMap()),
): BricklinkLinks = BricklinkLinks(
    success = success,
    links = links,
)

fun testBricksetQueueEntry(
    createdAt: String? = null,
    setNumber: String = "",
    name: String? = null,
    attempts: Int = 0,
    retryAfter: String? = null,
    lastError: String? = null,
): BricksetQueueEntry = BricksetQueueEntry(
    createdAt = createdAt,
    setNumber = setNumber,
    name = name,
    attempts = attempts,
    retryAfter = retryAfter,
    lastError = lastError,
)

fun testBricksetQueueResponse(
    success: Boolean = false,
    total: Int = 0,
    page: Int = 0,
    pageSize: Int = 0,
    count: Int = 0,
    entries: List<BricksetQueueEntry> = emptyList(),
): BricksetQueueResponse = BricksetQueueResponse(
    success = success,
    total = total,
    page = page,
    pageSize = pageSize,
    count = count,
    entries = entries,
)

fun testCacheStatsResponse(
    dbPool: JsonObject = JsonObject(emptyMap()),
    success: Boolean = false,
    prices: Int = 0,
    subsets: Int = 0,
    catalog: Int = 0,
    priceStale: Int = 0,
    rateLimits: RateLimits? = null,
    degraded: List<String> = emptyList(),
): CacheStatsResponse = CacheStatsResponse(
    dbPool = dbPool,
    success = success,
    prices = prices,
    subsets = subsets,
    catalog = catalog,
    priceStale = priceStale,
    rateLimits = rateLimits,
    degraded = degraded,
)

fun testCacheTtlResponse(
    success: Boolean = false,
    ttl: String = "",
): CacheTtlResponse = CacheTtlResponse(
    success = success,
    ttl = ttl,
)

fun testCatalogMetaResponse(
    success: Boolean = false,
    themes: List<CatalogTheme> = emptyList(),
    yearMin: Int? = null,
    yearMax: Int? = null,
    yearCounts: List<CatalogYearCount> = emptyList(),
): CatalogMetaResponse = CatalogMetaResponse(
    success = success,
    themes = themes,
    yearMin = yearMin,
    yearMax = yearMax,
    yearCounts = yearCounts,
)

fun testCatalogSetDetail(
    setNumber: String = "",
    name: String? = null,
    year: Int? = null,
    themeId: Int? = null,
    themeName: String? = null,
    numParts: Int? = null,
    imageUrl: String? = null,
    imageLocal: String? = null,
    minifigs: Int = 0,
    owned: Boolean = false,
    ownedQuantity: Int = 0,
    bricklink: BrickLinkRef? = null,
    priceComparisonUrl: String? = null,
): CatalogSetDetail = CatalogSetDetail(
    setNumber = setNumber,
    name = name,
    year = year,
    themeId = themeId,
    themeName = themeName,
    numParts = numParts,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    minifigs = minifigs,
    owned = owned,
    ownedQuantity = ownedQuantity,
    bricklink = bricklink,
    priceComparisonUrl = priceComparisonUrl,
)

fun testCatalogSetDetailResponse(
    success: Boolean = false,
    set: CatalogSetDetail? = null,
): CatalogSetDetailResponse = CatalogSetDetailResponse(
    success = success,
    set = set,
)

fun testCatalogSetItem(
    setNumber: String = "",
    name: String? = null,
    year: Int? = null,
    themeId: Int? = null,
    themeName: String? = null,
    numParts: Int? = null,
    imageUrl: String? = null,
    imageLocal: String? = null,
    owned: Boolean = false,
    ownedQuantity: Int = 0,
): CatalogSetItem = CatalogSetItem(
    setNumber = setNumber,
    name = name,
    year = year,
    themeId = themeId,
    themeName = themeName,
    numParts = numParts,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    owned = owned,
    ownedQuantity = ownedQuantity,
)

fun testCatalogSetsResponse(
    success: Boolean = false,
    total: Int = 0,
    page: Int = 0,
    pageSize: Int = 0,
    pages: Int = 0,
    sets: List<CatalogSetItem> = emptyList(),
): CatalogSetsResponse = CatalogSetsResponse(
    success = success,
    total = total,
    page = page,
    pageSize = pageSize,
    pages = pages,
    sets = sets,
)

fun testCatalogTheme(
    id: Int = 0,
    name: String = "",
    setCount: Int = 0,
): CatalogTheme = CatalogTheme(
    id = id,
    name = name,
    setCount = setCount,
)

fun testCatalogYearCount(
    year: Int = 0,
    n: Int = 0,
): CatalogYearCount = CatalogYearCount(
    year = year,
    n = n,
)

fun testCatalogYearDistributionResponse(
    success: Boolean = false,
    years: List<YearCount> = emptyList(),
): CatalogYearDistributionResponse = CatalogYearDistributionResponse(
    success = success,
    years = years,
)

fun testChartPoint(
    xLabel: String = "",
    value: Double = 0.0,
    yFrac: Double = 0.0,
): ChartPoint = ChartPoint(
    xLabel = xLabel,
    value = value,
    yFrac = yFrac,
)

fun testChartYAxis(
    label: String = "",
    value: Double = 0.0,
    frac: Double = 0.0,
): ChartYAxis = ChartYAxis(
    label = label,
    value = value,
    frac = frac,
)

fun testComponentHeader(
    number: String = "",
    name: String? = null,
    colorId: Int? = null,
    colorName: String? = null,
    colorHex: String? = null,
    categoryName: String? = null,
    imageLocal: String? = null,
    imageUrl: String? = null,
    isSpare: Boolean = false,
    storage: String? = null,
    ownerIds: List<Int> = emptyList(),
    totalQuantity: Int = 0,
): ComponentHeader = ComponentHeader(
    number = number,
    name = name,
    colorId = colorId,
    colorName = colorName,
    colorHex = colorHex,
    categoryName = categoryName,
    imageLocal = imageLocal,
    imageUrl = imageUrl,
    isSpare = isSpare,
    storage = storage,
    ownerIds = ownerIds,
    totalQuantity = totalQuantity,
)

fun testConditionValuation(
    marketPrice: Double? = null,
    purchasePrice: Double? = null,
    pnlPctText: String? = null,
    pnlPct: Double? = null,
): ConditionValuation = ConditionValuation(
    marketPrice = marketPrice,
    purchasePrice = purchasePrice,
    pnlPctText = pnlPctText,
    pnlPct = pnlPct,
)

fun testCsvImportResult(
    success: Boolean = false,
    total: Int = 0,
    added: Int = 0,
    updated: Int = 0,
    errors: Int = 0,
    results: List<CsvImportRow> = emptyList(),
    skipped: Int = 0,
    skippedHint: String = "",
    currencyNote: String? = null,
    started: Boolean = false,
    existing: Int = 0,
    existingNumbers: List<String> = emptyList(),
): CsvImportResult = CsvImportResult(
    success = success,
    total = total,
    added = added,
    updated = updated,
    errors = errors,
    results = results,
    skipped = skipped,
    skippedHint = skippedHint,
    currencyNote = currencyNote,
    started = started,
    existing = existing,
    existingNumbers = existingNumbers,
)

fun testCsvImportStatus(
    code: String? = null,
    results: List<CsvImportRow> = emptyList(),
    success: Boolean = false,
    status: RunStatus = RunStatus.UNKNOWN,
    total: Int = 0,
    done: Int = 0,
    current: String? = null,
    ok: Int = 0,
    warn: Int = 0,
    err: Int = 0,
    error: String? = null,
    finishedAt: String = "",
): CsvImportStatus = CsvImportStatus(
    code = code,
    results = results,
    success = success,
    status = status,
    total = total,
    done = done,
    current = current,
    ok = ok,
    warn = warn,
    err = err,
    error = error,
    finishedAt = finishedAt,
)

fun testCurrentPrice(
    condition: Condition = Condition.NEW,
    avgPrice: Double? = null,
    minPrice: Double? = null,
    maxPrice: Double? = null,
    fetchedAt: String? = null,
): CurrentPrice = CurrentPrice(
    condition = condition,
    avgPrice = avgPrice,
    minPrice = minPrice,
    maxPrice = maxPrice,
    fetchedAt = fetchedAt,
)

fun testDashboardStats(
    currency: String = "",
    defaultCondition: String = "",
    userDefaultCondition: String? = null,
    totalSets: Int = 0,
    totalQuantity: Int = 0,
    totalPieces: Int = 0,
    totalInstructions: Int = 0,
    totalParts: Int = 0,
    setParts: Int? = null,
    manualParts: Int? = null,
    totalMinifigs: Int = 0,
): DashboardStats = DashboardStats(
    currency = currency,
    defaultCondition = defaultCondition,
    userDefaultCondition = userDefaultCondition,
    totalSets = totalSets,
    totalQuantity = totalQuantity,
    totalPieces = totalPieces,
    totalInstructions = totalInstructions,
    totalParts = totalParts,
    setParts = setParts,
    manualParts = manualParts,
    totalMinifigs = totalMinifigs,
)

fun testDefaultConditionResponse(
    success: Boolean = false,
    condition: Condition = Condition.NEW,
): DefaultConditionResponse = DefaultConditionResponse(
    success = success,
    condition = condition,
)

fun testDeleteWithQuantityResponse(
    success: Boolean = false,
    newQuantity: Int = 0,
): DeleteWithQuantityResponse = DeleteWithQuantityResponse(
    success = success,
    newQuantity = newQuantity,
)

fun testDeleted(
    success: Boolean = false,
    deleted: Int = 0,
): Deleted = Deleted(
    success = success,
    deleted = deleted,
)

fun testDone(
    success: Boolean = false,
): Done = Done(
    success = success,
)

fun testEmailPreview(
    success: Boolean = false,
    username: String = "",
): EmailPreview = EmailPreview(
    success = success,
    username = username,
)

fun testEndpoints(
    auth: JsonObject = JsonObject(emptyMap()),
    api: String = "",
    version: String = "",
    endpoints: JsonObject = JsonObject(emptyMap()),
): Endpoints = Endpoints(
    auth = auth,
    api = api,
    version = version,
    endpoints = endpoints,
)

fun testErrorResponse(
    success: Boolean = false,
    error: String = "",
    code: String = "",
): ErrorResponse = ErrorResponse(
    success = success,
    error = error,
    code = code,
)

fun testFigValuationItem(
    id: Int? = null,
    quantity: Int = 0,
    imageUrl: String? = null,
    imageLocal: String? = null,
    purchasePrice: Double? = null,
    avgPrice: Double? = null,
    condition: Condition? = null,
    conditions: List<Condition> = emptyList(),
    userId: Int? = null,
    owners: List<AccountName> = emptyList(),
    figNumber: String = "",
    blFigNumber: String? = null,
    figName: String? = null,
    setNumber: String? = null,
    source: String? = null,
    storageId: Int? = null,
    pending: Boolean = false,
    fromCache: Boolean = false,
    maxPrice: Double? = null,
    minPrice: Double? = null,
    qtyAvgPrice: Double? = null,
    pnlPct: String? = null,
    pnlPercent: Double? = null,
    displayValue: String? = null,
    totalValue: String = "",
    valueTotal: Double? = null,
    acquisitions: List<ValuationAcquisition> = emptyList(),
    acqCount: Int? = null,
    usedCount: Int? = null,
    avgPurchasePrice: Double? = null,
    storage: String? = null,
    unitPrice: Double? = null,
): FigValuationItem = FigValuationItem(
    id = id,
    quantity = quantity,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    purchasePrice = purchasePrice,
    avgPrice = avgPrice,
    condition = condition,
    conditions = conditions,
    userId = userId,
    owners = owners,
    figNumber = figNumber,
    blFigNumber = blFigNumber,
    figName = figName,
    setNumber = setNumber,
    source = source,
    storageId = storageId,
    pending = pending,
    fromCache = fromCache,
    maxPrice = maxPrice,
    minPrice = minPrice,
    qtyAvgPrice = qtyAvgPrice,
    pnlPct = pnlPct,
    pnlPercent = pnlPercent,
    displayValue = displayValue,
    totalValue = totalValue,
    valueTotal = valueTotal,
    acquisitions = acquisitions,
    acqCount = acqCount,
    usedCount = usedCount,
    avgPurchasePrice = avgPurchasePrice,
    storage = storage,
    unitPrice = unitPrice,
)

fun testFigsValuationResponse(
    convertedPurchasePrices: Int = 0,
    success: Boolean = false,
    total: Int = 0,
    page: Int = 0,
    pageSize: Int = 0,
    currency: CurrencyCode = CurrencyCode.NONE,
    figs: List<FigValuationItem> = emptyList(),
    totalValue: String = "",
    valueTotal: Double? = null,
    pricesPending: Int = 0,
    foreignCurrencyPurchases: Int = 0,
): FigsValuationResponse = FigsValuationResponse(
    convertedPurchasePrices = convertedPurchasePrices,
    success = success,
    total = total,
    page = page,
    pageSize = pageSize,
    currency = currency,
    figs = figs,
    totalValue = totalValue,
    valueTotal = valueTotal,
    pricesPending = pricesPending,
    foreignCurrencyPurchases = foreignCurrencyPurchases,
)

fun testForgotPasswordResponse(
    success: Boolean = false,
    message: String? = null,
    error: String? = null,
): ForgotPasswordResponse = ForgotPasswordResponse(
    success = success,
    message = message,
    error = error,
)

fun testGenericAdminResponse(
    success: Boolean = false,
    condition: String? = null,
    message: String = "",
    setNumber: String = "",
    started: Boolean = false,
    theme: String = "",
    ttl: JsonElement = JsonNull,
    queued: Int = 0,
    pending: Int = 0,
    skipped: Int = 0,
    discarded: Int = 0,
    durationMinutes: Int = 0,
    enqueued: Int = 0,
): GenericAdminResponse = GenericAdminResponse(
    success = success,
    condition = condition,
    message = message,
    setNumber = setNumber,
    started = started,
    theme = theme,
    ttl = ttl,
    queued = queued,
    pending = pending,
    skipped = skipped,
    discarded = discarded,
    durationMinutes = durationMinutes,
    enqueued = enqueued,
)

fun testGenericResponse(
    success: Boolean = false,
    newQuantity: Int = 0,
    fromUserId: Int = 0,
    toUserId: Int = 0,
    merged: Boolean = false,
    unchanged: Boolean = false,
    acquisitions: Int = 0,
    instructions: Int = 0,
    set: SetAggregate? = null,
    parts: Int = 0,
    minifigs: Int = 0,
    sourceEmptied: Boolean = false,
    quantity: Int? = null,
    degraded: List<String> = emptyList(),
    trash: List<Int> = emptyList(),
    linkedTo: AccountName? = null,
    removed: Int = 0,
    instruction: InstructionUploadedInstruction? = null,
    updated: Int = 0,
    deleted: Int = 0,
): GenericResponse = GenericResponse(
    success = success,
    newQuantity = newQuantity,
    fromUserId = fromUserId,
    toUserId = toUserId,
    merged = merged,
    unchanged = unchanged,
    acquisitions = acquisitions,
    instructions = instructions,
    set = set,
    parts = parts,
    minifigs = minifigs,
    sourceEmptied = sourceEmptied,
    quantity = quantity,
    degraded = degraded,
    trash = trash,
    linkedTo = linkedTo,
    removed = removed,
    instruction = instruction,
    updated = updated,
    deleted = deleted,
)

fun testHealth(
    status: String = "",
    startup: StartupStatus? = null,
    dbPool: JsonObject = JsonObject(emptyMap()),
    uptimeSeconds: Int = 0,
): Health = Health(
    status = status,
    startup = startup,
    dbPool = dbPool,
    uptimeSeconds = uptimeSeconds,
)

fun testHeartbeat(
    status: String = "",
): Heartbeat = Heartbeat(
    status = status,
)

fun testHoldingCleared(
    success: Boolean = false,
    sets: Int = 0,
    parts: Int = 0,
    minifigs: Int = 0,
    trash: List<Int> = emptyList(),
): HoldingCleared = HoldingCleared(
    success = success,
    sets = sets,
    parts = parts,
    minifigs = minifigs,
    trash = trash,
)

fun testHoldingEntry(
    total: Int = 0,
    loose: Int = 0,
): HoldingEntry = HoldingEntry(
    total = total,
    loose = loose,
)

fun testHoldingResponse(
    success: Boolean = false,
    holding: Map<String, HoldingEntry> = emptyMap(),
): HoldingResponse = HoldingResponse(
    success = success,
    holding = holding,
)

fun testHouseholdInviteCheckResponse(
    success: Boolean = false,
    inviter: HouseholdInviteCheckResponseInviter = testHouseholdInviteCheckResponseInviter(),
): HouseholdInviteCheckResponse = HouseholdInviteCheckResponse(
    success = success,
    inviter = inviter,
)

fun testHouseholdInviteCheckResponseInviter(
    id: Int = 0,
    username: String = "",
): HouseholdInviteCheckResponseInviter = HouseholdInviteCheckResponseInviter(
    id = id,
    username = username,
)

fun testHouseholdInviteResponse(
    success: Boolean = false,
    code: String? = null,
    expiresIn: Int? = null,
): HouseholdInviteResponse = HouseholdInviteResponse(
    success = success,
    code = code,
    expiresIn = expiresIn,
)

fun testHouseholdMember(
    depth: Int = 0,
    id: Int = 0,
    username: String = "",
    isSelf: Boolean = false,
): HouseholdMember = HouseholdMember(
    depth = depth,
    id = id,
    username = username,
    isSelf = isSelf,
)

fun testHouseholdMembersResponse(
    success: Boolean = false,
    members: List<HouseholdMember> = emptyList(),
): HouseholdMembersResponse = HouseholdMembersResponse(
    success = success,
    members = members,
)

fun testHouseholdStatusResponse(
    view: List<HouseholdMember> = emptyList(),
    success: Boolean = false,
    isMain: Boolean = false,
    isSub: Boolean = false,
    currency: CurrencyCode = CurrencyCode.NONE,
    linkedTo: AccountName? = null,
    parents: List<AccountName> = emptyList(),
    subAccounts: List<HouseholdMember> = emptyList(),
    openInvites: Int = 0,
    formerLinks: List<SeparatedAccount> = emptyList(),
    degraded: List<String> = emptyList(),
): HouseholdStatusResponse = HouseholdStatusResponse(
    view = view,
    success = success,
    isMain = isMain,
    isSub = isSub,
    currency = currency,
    linkedTo = linkedTo,
    parents = parents,
    subAccounts = subAccounts,
    openInvites = openInvites,
    formerLinks = formerLinks,
    degraded = degraded,
)

fun testImageDiagnosis(
    success: Boolean = false,
    setNumber: String = "",
    hints: List<String> = emptyList(),
    database: ImageDiagnosisDatabase = testImageDiagnosisDatabase(),
    local: ImageDiagnosisLocal = testImageDiagnosisLocal(),
    proxy: ImageDiagnosisProxy = testImageDiagnosisProxy(),
    marker: ImageDiagnosisMarker? = null,
): ImageDiagnosis = ImageDiagnosis(
    success = success,
    setNumber = setNumber,
    hints = hints,
    database = database,
    local = local,
    proxy = proxy,
    marker = marker,
)

fun testImageDiagnosisDatabase(
    accountCount: Int = 0,
    imageLocal: String? = null,
    imageUrl: String? = null,
    catalogImage: String? = null,
): ImageDiagnosisDatabase = ImageDiagnosisDatabase(
    accountCount = accountCount,
    imageLocal = imageLocal,
    imageUrl = imageUrl,
    catalogImage = catalogImage,
)

fun testImageDiagnosisLocal(
    original: ImageDiagnosisLocalOriginal = testImageDiagnosisLocalOriginal(),
    preview: ImageDiagnosisLocalPreview = testImageDiagnosisLocalPreview(),
): ImageDiagnosisLocal = ImageDiagnosisLocal(
    original = original,
    preview = preview,
)

fun testImageDiagnosisLocalOriginal(
    existing: Boolean = false,
    bytes: Int = 0,
    changed: String? = null,
): ImageDiagnosisLocalOriginal = ImageDiagnosisLocalOriginal(
    existing = existing,
    bytes = bytes,
    changed = changed,
)

fun testImageDiagnosisLocalPreview(
    existing: Boolean = false,
    bytes: Int = 0,
    changed: String? = null,
): ImageDiagnosisLocalPreview = ImageDiagnosisLocalPreview(
    existing = existing,
    bytes = bytes,
    changed = changed,
)

fun testImageDiagnosisMarker(
    since: String? = null,
    reason: String? = null,
): ImageDiagnosisMarker = ImageDiagnosisMarker(
    since = since,
    reason = reason,
)

fun testImageDiagnosisProxy(
    cached: Boolean = false,
    address: String? = null,
): ImageDiagnosisProxy = ImageDiagnosisProxy(
    cached = cached,
    address = address,
)

fun testImageMarkerForgotten(
    success: Boolean = false,
    removed: Int = 0,
    hint: String = "",
): ImageMarkerForgotten = ImageMarkerForgotten(
    success = success,
    removed = removed,
    hint = hint,
)

fun testInstruction(
    downloadedAt: String? = null,
    fetchedAt: String? = null,
    setNumber: String = "",
    userId: Int? = null,
    id: Int = 0,
    url: String = "",
    description: String? = null,
    localPath: String? = null,
    isManual: Boolean = false,
): Instruction = Instruction(
    downloadedAt = downloadedAt,
    fetchedAt = fetchedAt,
    setNumber = setNumber,
    userId = userId,
    id = id,
    url = url,
    description = description,
    localPath = localPath,
    isManual = isManual,
)

fun testInstructionUploadedInstruction(
    url: String = "",
    description: String? = null,
    localPath: String = "",
): InstructionUploadedInstruction = InstructionUploadedInstruction(
    url = url,
    description = description,
    localPath = localPath,
)

fun testInstructionsLoaded(
    success: Boolean = false,
    count: Int = 0,
    instructions: List<Instruction> = emptyList(),
    jobId: String? = null,
): InstructionsLoaded = InstructionsLoaded(
    success = success,
    count = count,
    instructions = instructions,
    jobId = jobId,
)

fun testJob(
    id: String = "",
    type: String = "",
    status: String = "",
    attempts: Int = 0,
    maxAttempts: Int = 0,
    dueAt: String? = null,
    deadlineAt: String? = null,
    startedAt: String? = null,
    createdAt: String? = null,
    updatedAt: String? = null,
    progress: JobProgress? = null,
    errorMessage: String? = null,
    scheduled: Boolean = false,
    waiting: Boolean = false,
    setNumber: String? = null,
): Job = Job(
    id = id,
    type = type,
    status = status,
    attempts = attempts,
    maxAttempts = maxAttempts,
    dueAt = dueAt,
    deadlineAt = deadlineAt,
    startedAt = startedAt,
    createdAt = createdAt,
    updatedAt = updatedAt,
    progress = progress,
    errorMessage = errorMessage,
    scheduled = scheduled,
    waiting = waiting,
    setNumber = setNumber,
)

fun testJobChange(
    success: Boolean = false,
    id: String = "",
    status: String = "",
): JobChange = JobChange(
    success = success,
    id = id,
    status = status,
)

fun testJobCounter(
    type: String = "",
    status: String = "",
    count: Int = 0,
): JobCounter = JobCounter(
    type = type,
    status = status,
    count = count,
)

fun testJobKindDrain(
    success: Boolean = false,
    kind: String = "",
    removed: Int = 0,
): JobKindDrain = JobKindDrain(
    success = success,
    kind = kind,
    removed = removed,
)

fun testJobKindStart(
    success: Boolean = false,
    kind: String = "",
    started: Boolean = false,
): JobKindStart = JobKindStart(
    success = success,
    kind = kind,
    started = started,
)

fun testJobPause(
    type: String = "",
    untilAt: String? = null,
    reason: String? = null,
): JobPause = JobPause(
    type = type,
    untilAt = untilAt,
    reason = reason,
)

fun testJobProcess(
    heartbeat: String? = null,
    ageSeconds: Int? = null,
    running: Boolean = false,
): JobProcess = JobProcess(
    heartbeat = heartbeat,
    ageSeconds = ageSeconds,
    running = running,
)

fun testJobQueueResponse(
    success: Boolean = false,
    jobs: List<Job> = emptyList(),
    summary: List<JobCounter> = emptyList(),
    pauses: List<JobPause> = emptyList(),
    imageDemand: Int = 0,
    jobProcess: JobProcess = testJobProcess(),
): JobQueueResponse = JobQueueResponse(
    success = success,
    jobs = jobs,
    summary = summary,
    pauses = pauses,
    imageDemand = imageDemand,
    jobProcess = jobProcess,
)

fun testJobSchedule(
    type: String = "",
    time: String? = null,
    minutes: Int? = null,
): JobSchedule = JobSchedule(
    type = type,
    time = time,
    minutes = minutes,
)

fun testJobStatus(
    lastRun: JsonElement? = null,
    canRedownload: Boolean = false,
    queue: Int? = null,
    queueLastRun: JsonElement? = null,
    label: String = "",
    status: RunStatus = RunStatus.UNKNOWN,
    progress: Int = 0,
    total: Int = 0,
    sub: String? = null,
    subParts: List<JobStatusSubPartsEntry> = emptyList(),
): JobStatus = JobStatus(
    lastRun = lastRun,
    canRedownload = canRedownload,
    queue = queue,
    queueLastRun = queueLastRun,
    label = label,
    status = status,
    progress = progress,
    total = total,
    sub = sub,
    subParts = subParts,
)

fun testJobStatusSubPartsEntry(
    code: String = "",
    values: JsonObject = JsonObject(emptyMap()),
    ago: String = "",
): JobStatusSubPartsEntry = JobStatusSubPartsEntry(
    code = code,
    values = values,
    ago = ago,
)

fun testJobsResponse(
    db: JsonObject = JsonObject(emptyMap()),
    success: Boolean = false,
    jobs: Map<String, JobStatus> = emptyMap(),
    schedules: Map<String, JobSchedule> = emptyMap(),
    degraded: List<String> = emptyList(),
    proxyHint: JobsResponseProxyHint? = null,
): JobsResponse = JobsResponse(
    db = db,
    success = success,
    jobs = jobs,
    schedules = schedules,
    degraded = degraded,
    proxyHint = proxyHint,
)

fun testJobsResponseProxyHint(
    kind: String = "",
    vars: JobsResponseProxyHintVars = testJobsResponseProxyHintVars(),
): JobsResponseProxyHint = JobsResponseProxyHint(
    kind = kind,
    vars = vars,
)

fun testJobsResponseProxyHintVars(
    ip: String = "",
    minutes: Int = 0,
    count: Int = 0,
): JobsResponseProxyHintVars = JobsResponseProxyHintVars(
    ip = ip,
    minutes = minutes,
    count = count,
)

fun testKeyNonceResponse(
    success: Boolean = false,
    nonce: String = "",
): KeyNonceResponse = KeyNonceResponse(
    success = success,
    nonce = nonce,
)

fun testLogEntries(
    success: Boolean = false,
    entries: List<JsonObject> = emptyList(),
): LogEntries = LogEntries(
    success = success,
    entries = entries,
)

fun testLogResponse(
    success: Boolean = false,
    minutes: Int = 0,
    count: Int = 0,
    logs: List<LogRow> = emptyList(),
): LogResponse = LogResponse(
    success = success,
    minutes = minutes,
    count = count,
    logs = logs,
)

fun testLoginResponse(
    success: Boolean = false,
    token: String? = null,
    user: User? = null,
    error: String? = null,
    secondFactor: Boolean = false,
    neverExpires: Boolean = false,
    tokenInfo: TokenInfo? = null,
    cookieMissing: Boolean = false,
): LoginResponse = LoginResponse(
    success = success,
    token = token,
    user = user,
    error = error,
    secondFactor = secondFactor,
    neverExpires = neverExpires,
    tokenInfo = tokenInfo,
    cookieMissing = cookieMissing,
)

fun testManualFigsResponse(
    success: Boolean = false,
    total: Int = 0,
    page: Int = 0,
    pageSize: Int = 0,
    figs: List<FigValuationItem> = emptyList(),
    degraded: List<String> = emptyList(),
): ManualFigsResponse = ManualFigsResponse(
    success = success,
    total = total,
    page = page,
    pageSize = pageSize,
    figs = figs,
    degraded = degraded,
)

fun testManualPartsResponse(
    success: Boolean = false,
    total: Int = 0,
    page: Int = 0,
    pageSize: Int = 0,
    parts: List<PartValuationItem> = emptyList(),
    degraded: List<String> = emptyList(),
): ManualPartsResponse = ManualPartsResponse(
    success = success,
    total = total,
    page = page,
    pageSize = pageSize,
    parts = parts,
    degraded = degraded,
)

fun testMeResponse(
    success: Boolean = false,
    loggedIn: Boolean = false,
    user: User? = null,
    tokenExpires: String? = null,
    tokenLastUsed: String? = null,
    tokenInfo: TokenInfo? = null,
): MeResponse = MeResponse(
    success = success,
    loggedIn = loggedIn,
    user = user,
    tokenExpires = tokenExpires,
    tokenLastUsed = tokenLastUsed,
    tokenInfo = tokenInfo,
)

fun testMinifig(
    id: Int? = null,
    inSets: String? = null,
    setNumber: String? = null,
    storage: String? = null,
    unitPrice: Double? = null,
    figNumber: String = "",
    condition: Condition? = null,
    conditions: List<Condition> = emptyList(),
    owners: List<AccountName> = emptyList(),
    ownerIds: List<Int> = emptyList(),
    avgPurchasePrice: Double? = null,
    figName: String? = null,
    quantity: Int = 0,
    totalQuantity: Int? = null,
    imageUrl: String? = null,
    imageLocal: String? = null,
    source: String = "",
    setAddedAt: String? = null,
): Minifig = Minifig(
    id = id,
    inSets = inSets,
    setNumber = setNumber,
    storage = storage,
    unitPrice = unitPrice,
    figNumber = figNumber,
    condition = condition,
    conditions = conditions,
    owners = owners,
    ownerIds = ownerIds,
    avgPurchasePrice = avgPurchasePrice,
    figName = figName,
    quantity = quantity,
    totalQuantity = totalQuantity,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    source = source,
    setAddedAt = setAddedAt,
)

fun testMinifigParts(
    success: Boolean = false,
    source: String = "",
    parts: List<JsonObject> = emptyList(),
): MinifigParts = MinifigParts(
    success = success,
    source = source,
    parts = parts,
)

fun testMinifigStats(
    uniqueFigs: Int = 0,
    types: Int = 0,
    totalQuantity: Int = 0,
    manual: Int = 0,
): MinifigStats = MinifigStats(
    uniqueFigs = uniqueFigs,
    types = types,
    totalQuantity = totalQuantity,
    manual = manual,
)

fun testMinifigStatsResponse(
    success: Boolean = false,
    stats: MinifigStats = testMinifigStats(),
): MinifigStatsResponse = MinifigStatsResponse(
    success = success,
    stats = stats,
)

fun testMinifigsResponse(
    success: Boolean = false,
    total: Int = 0,
    figs: List<Minifig> = emptyList(),
    source: String = "",
    error: String = "",
): MinifigsResponse = MinifigsResponse(
    success = success,
    total = total,
    figs = figs,
    source = source,
    error = error,
)

fun testMoveSetResponse(
    success: Boolean = false,
    setNumber: String = "",
    quantity: Int = 0,
    acquisitions: Int = 0,
    merged: Boolean = false,
    parts: Int = 0,
    minifigs: Int = 0,
    instructions: Int = 0,
    sourceEmptied: Boolean = false,
    fromUserId: Int = 0,
    toUserId: Int = 0,
): MoveSetResponse = MoveSetResponse(
    success = success,
    setNumber = setNumber,
    quantity = quantity,
    acquisitions = acquisitions,
    merged = merged,
    parts = parts,
    minifigs = minifigs,
    instructions = instructions,
    sourceEmptied = sourceEmptied,
    fromUserId = fromUserId,
    toUserId = toUserId,
)

fun testOthersEnded(
    success: Boolean = false,
    deleted: Int = 0,
    accesses: Int = 0,
): OthersEnded = OthersEnded(
    success = success,
    deleted = deleted,
    accesses = accesses,
)

fun testParsedVoucher(
    number: String? = null,
    pin: String? = null,
    amount: Double? = null,
    currency: CurrencyCode? = null,
): ParsedVoucher = ParsedVoucher(
    number = number,
    pin = pin,
    amount = amount,
    currency = currency,
)

fun testPart(
    partNumber: String = "",
    blPartNumber: String? = null,
    partName: String? = null,
    colorId: Int = 0,
    colorName: String? = null,
    colorHex: String? = null,
    imageUrl: String? = null,
    totalQuantity: Int = 0,
    isSpare: Boolean = false,
    condition: String? = null,
    storage: String? = null,
    categoryName: String? = null,
    imageLocal: String? = null,
    inSets: String? = null,
    blColorId: Int? = null,
): Part = Part(
    partNumber = partNumber,
    blPartNumber = blPartNumber,
    partName = partName,
    colorId = colorId,
    colorName = colorName,
    colorHex = colorHex,
    imageUrl = imageUrl,
    totalQuantity = totalQuantity,
    isSpare = isSpare,
    condition = condition,
    storage = storage,
    categoryName = categoryName,
    imageLocal = imageLocal,
    inSets = inSets,
    blColorId = blColorId,
)

fun testPartColorResponse(
    image: String? = null,
    success: Boolean = false,
    combined: Boolean = false,
    moved: Int = 0,
    united: Int = 0,
): PartColorResponse = PartColorResponse(
    image = image,
    success = success,
    combined = combined,
    moved = moved,
    united = united,
)

fun testPartValuationItem(
    id: Int? = null,
    quantity: Int = 0,
    imageUrl: String? = null,
    imageLocal: String? = null,
    purchasePrice: Double? = null,
    avgPrice: Double? = null,
    condition: Condition? = null,
    conditions: List<Condition> = emptyList(),
    userId: Int? = null,
    owners: List<AccountName> = emptyList(),
    partNumber: String = "",
    blPartNumber: String? = null,
    partName: String? = null,
    colorId: Int = 0,
    colorName: String? = null,
    colorHex: String? = null,
    unitPrice: Double? = null,
    acqCount: Int? = null,
    usedCount: Int? = null,
    avgPurchasePrice: Double? = null,
    storage: String? = null,
    categoryName: String? = null,
    createdAt: String? = null,
    source: String? = null,
    pending: Boolean = false,
    fromCache: Boolean = false,
    maxPrice: Double? = null,
    minPrice: Double? = null,
    qtyAvgPrice: Double? = null,
    pnlPct: String? = null,
    pnlPercent: Double? = null,
    displayValue: String? = null,
    totalValue: String = "",
    valueTotal: Double? = null,
    acquisitions: List<ValuationAcquisition> = emptyList(),
): PartValuationItem = PartValuationItem(
    id = id,
    quantity = quantity,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    purchasePrice = purchasePrice,
    avgPrice = avgPrice,
    condition = condition,
    conditions = conditions,
    userId = userId,
    owners = owners,
    partNumber = partNumber,
    blPartNumber = blPartNumber,
    partName = partName,
    colorId = colorId,
    colorName = colorName,
    colorHex = colorHex,
    unitPrice = unitPrice,
    acqCount = acqCount,
    usedCount = usedCount,
    avgPurchasePrice = avgPurchasePrice,
    storage = storage,
    categoryName = categoryName,
    createdAt = createdAt,
    source = source,
    pending = pending,
    fromCache = fromCache,
    maxPrice = maxPrice,
    minPrice = minPrice,
    qtyAvgPrice = qtyAvgPrice,
    pnlPct = pnlPct,
    pnlPercent = pnlPercent,
    displayValue = displayValue,
    totalValue = totalValue,
    valueTotal = valueTotal,
    acquisitions = acquisitions,
)

fun testPartsCategoriesResponse(
    success: Boolean = false,
    categories: List<PartsCategory> = emptyList(),
): PartsCategoriesResponse = PartsCategoriesResponse(
    success = success,
    categories = categories,
)

fun testPartsCategory(
    categoryName: String? = null,
    label: String? = null,
    uniqueParts: Int = 0,
    totalQuantity: Int = 0,
): PartsCategory = PartsCategory(
    categoryName = categoryName,
    label = label,
    uniqueParts = uniqueParts,
    totalQuantity = totalQuantity,
)

fun testPartsFilterColor(
    colorName: String? = null,
    colorHex: String? = null,
    uniqueParts: Int = 0,
    totalQuantity: Int = 0,
): PartsFilterColor = PartsFilterColor(
    colorName = colorName,
    colorHex = colorHex,
    uniqueParts = uniqueParts,
    totalQuantity = totalQuantity,
)

fun testPartsFilterColorsResponse(
    success: Boolean = false,
    colors: List<PartsFilterColor> = emptyList(),
): PartsFilterColorsResponse = PartsFilterColorsResponse(
    success = success,
    colors = colors,
)

fun testPartsLoaded(
    success: Boolean = false,
    count: Int = 0,
): PartsLoaded = PartsLoaded(
    success = success,
    count = count,
)

fun testPartsResponse(
    source: String? = null,
    success: Boolean = false,
    total: Int = 0,
    page: Int = 0,
    pageSize: Int = 0,
    parts: List<Part> = emptyList(),
    degraded: List<String> = emptyList(),
    error: String = "",
): PartsResponse = PartsResponse(
    source = source,
    success = success,
    total = total,
    page = page,
    pageSize = pageSize,
    parts = parts,
    degraded = degraded,
    error = error,
)

fun testPartsStats(
    uniqueParts: Int = 0,
    uniqueColors: Int = 0,
    totalParts: Int = 0,
    manualParts: Int? = null,
): PartsStats = PartsStats(
    uniqueParts = uniqueParts,
    uniqueColors = uniqueColors,
    totalParts = totalParts,
    manualParts = manualParts,
)

fun testPartsStatsResponse(
    success: Boolean = false,
    stats: PartsStats? = null,
): PartsStatsResponse = PartsStatsResponse(
    success = success,
    stats = stats,
)

fun testPartsValuationResponse(
    convertedPurchasePrices: Int = 0,
    success: Boolean = false,
    total: Int = 0,
    page: Int = 0,
    pageSize: Int = 0,
    currency: CurrencyCode = CurrencyCode.NONE,
    parts: List<PartValuationItem> = emptyList(),
    totalValue: String = "",
    valueTotal: Double? = null,
    pricesPending: Int = 0,
    foreignCurrencyPurchases: Int = 0,
): PartsValuationResponse = PartsValuationResponse(
    convertedPurchasePrices = convertedPurchasePrices,
    success = success,
    total = total,
    page = page,
    pageSize = pageSize,
    currency = currency,
    parts = parts,
    totalValue = totalValue,
    valueTotal = valueTotal,
    pricesPending = pricesPending,
    foreignCurrencyPurchases = foreignCurrencyPurchases,
)

fun testPasskey(
    id: Int = 0,
    name: String? = null,
    transports: String? = null,
    createdAt: String = "",
    lastUsed: String? = null,
): Passkey = Passkey(
    id = id,
    name = name,
    transports = transports,
    createdAt = createdAt,
    lastUsed = lastUsed,
)

fun testPasskeyCreated(
    success: Boolean = false,
    passkey: PasskeyCreatedPasskey = testPasskeyCreatedPasskey(),
): PasskeyCreated = PasskeyCreated(
    success = success,
    passkey = passkey,
)

fun testPasskeyCreatedPasskey(
    id: Int = 0,
    name: String = "",
): PasskeyCreatedPasskey = PasskeyCreatedPasskey(
    id = id,
    name = name,
)

fun testPasskeyList(
    success: Boolean = false,
    available: Boolean = false,
    passkeys: List<Passkey> = emptyList(),
): PasskeyList = PasskeyList(
    success = success,
    available = available,
    passkeys = passkeys,
)

fun testPasskeyOptions(
    success: Boolean = false,
    options: JsonObject = JsonObject(emptyMap()),
): PasskeyOptions = PasskeyOptions(
    success = success,
    options = options,
)

fun testPasswordSet(
    success: Boolean = false,
    effectiveAt: String = "",
): PasswordSet = PasswordSet(
    success = success,
    effectiveAt = effectiveAt,
)

fun testPdfInputPartsEntry(
    partNumber: String = "",
    blPartNumber: String? = null,
    partName: String? = null,
    colorName: String? = null,
    colorHex: String? = null,
    colorId: Int? = null,
    quantity: JsonElement = JsonNull,
    isFig: JsonElement? = null,
    imageUrl: String? = null,
    imageLocal: String? = null,
): PdfInputPartsEntry = PdfInputPartsEntry(
    partNumber = partNumber,
    blPartNumber = blPartNumber,
    partName = partName,
    colorName = colorName,
    colorHex = colorHex,
    colorId = colorId,
    quantity = quantity,
    isFig = isFig,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
)

fun testPdfInputSetsEntry(
    setNumber: String = "",
    name: String? = null,
): PdfInputSetsEntry = PdfInputSetsEntry(
    setNumber = setNumber,
    name = name,
)

fun testPdfJobResponse(
    success: Boolean = false,
    jobId: String = "",
): PdfJobResponse = PdfJobResponse(
    success = success,
    jobId = jobId,
)

fun testPdfJobState(
    success: Boolean = false,
    status: RunStatus = RunStatus.UNKNOWN,
    error: String? = null,
    etaSeconds: Double? = null,
    missingImages: JsonElement? = null,
): PdfJobState = PdfJobState(
    success = success,
    status = status,
    error = error,
    etaSeconds = etaSeconds,
    missingImages = missingImages,
)

fun testPendingAlertsResponse(
    success: Boolean = false,
    alerts: List<PriceAlert> = emptyList(),
    now: String? = null,
): PendingAlertsResponse = PendingAlertsResponse(
    success = success,
    alerts = alerts,
    now = now,
)

fun testPnlResponse(
    success: Boolean = false,
    total: Int = 0,
    page: Int = 0,
    pageSize: Int = 0,
    currency: CurrencyCode = CurrencyCode.NONE,
    totals: PnlTotals = testPnlTotals(),
    sets: List<PnlSetRow> = emptyList(),
): PnlResponse = PnlResponse(
    success = success,
    total = total,
    page = page,
    pageSize = pageSize,
    currency = currency,
    totals = totals,
    sets = sets,
)

fun testPnlSetRow(
    addedAt: String? = null,
    condition: String = "",
    imageLocal: String? = null,
    imageUrl: String? = null,
    name: String? = null,
    pnlAbs: String? = null,
    purchasePrice: Double? = null,
    year: Int? = null,
    setNumber: String = "",
    quantity: Int = 0,
    currentPrice: Double? = null,
    baselinePrice: Double? = null,
    pnlPct: String? = null,
    baselinePnlPct: String? = null,
    pnlAmount: Double? = null,
    pnlPercent: Double? = null,
    baselinePnlPercent: Double? = null,
    tilePrice: Double? = null,
    tilePnlPct: Double? = null,
    tileSource: String? = null,
): PnlSetRow = PnlSetRow(
    addedAt = addedAt,
    condition = condition,
    imageLocal = imageLocal,
    imageUrl = imageUrl,
    name = name,
    pnlAbs = pnlAbs,
    purchasePrice = purchasePrice,
    year = year,
    setNumber = setNumber,
    quantity = quantity,
    currentPrice = currentPrice,
    baselinePrice = baselinePrice,
    pnlPct = pnlPct,
    baselinePnlPct = baselinePnlPct,
    pnlAmount = pnlAmount,
    pnlPercent = pnlPercent,
    baselinePnlPercent = baselinePnlPercent,
    tilePrice = tilePrice,
    tilePnlPct = tilePnlPct,
    tileSource = tileSource,
)

fun testPnlTotals(
    convertedPurchasePrices: Int = 0,
    pnlCurrent: JsonElement? = null,
    pnlPurchase: JsonElement? = null,
    purchase: String = "",
    current: String = "",
    pnlPct: String? = null,
    pnlPercent: Double? = null,
    foreignCurrencyPurchases: Int = 0,
    setsPurchase: String = "",
    partsPurchase: String = "",
    figsPurchase: String = "",
    grandTotal: String = "",
    positions: Int? = null,
    positionsValued: Int? = null,
    positionsWithoutMarketPrice: Int? = null,
    positionsWithoutPurchasePrice: Int? = null,
    baselineCost: String? = null,
    baselineMarketValue: String? = null,
    baselinePnlAmount: String? = null,
    costWithoutMarketPrice: String? = null,
    marketValueWithoutPurchasePrice: String? = null,
): PnlTotals = PnlTotals(
    convertedPurchasePrices = convertedPurchasePrices,
    pnlCurrent = pnlCurrent,
    pnlPurchase = pnlPurchase,
    purchase = purchase,
    current = current,
    pnlPct = pnlPct,
    pnlPercent = pnlPercent,
    foreignCurrencyPurchases = foreignCurrencyPurchases,
    setsPurchase = setsPurchase,
    partsPurchase = partsPurchase,
    figsPurchase = figsPurchase,
    grandTotal = grandTotal,
    positions = positions,
    positionsValued = positionsValued,
    positionsWithoutMarketPrice = positionsWithoutMarketPrice,
    positionsWithoutPurchasePrice = positionsWithoutPurchasePrice,
    baselineCost = baselineCost,
    baselineMarketValue = baselineMarketValue,
    baselinePnlAmount = baselinePnlAmount,
    costWithoutMarketPrice = costWithoutMarketPrice,
    marketValueWithoutPurchasePrice = marketValueWithoutPurchasePrice,
)

fun testPortfolioHistoryResponse(
    chart: PriceChartData? = null,
    dataPoints: Int? = null,
    success: Boolean = false,
    currency: CurrencyCode = CurrencyCode.NONE,
    period: String = "",
    points: List<ChartPoint> = emptyList(),
    yAxis: List<ChartYAxis> = emptyList(),
    periodChangePct: Double? = null,
    purchaseTotal: String? = null,
): PortfolioHistoryResponse = PortfolioHistoryResponse(
    chart = chart,
    dataPoints = dataPoints,
    success = success,
    currency = currency,
    period = period,
    points = points,
    yAxis = yAxis,
    periodChangePct = periodChangePct,
    purchaseTotal = purchaseTotal,
)

fun testPriceAlert(
    setNumber: String = "",
    condition: Condition = Condition.NEW,
    direction: AlarmDirection = AlarmDirection.BELOW,
    threshold: Double = 0.0,
    currencyCode: CurrencyCode = CurrencyCode.NONE,
    triggered: Boolean = false,
    lastTriggeredAt: String? = null,
    lastPrice: Double? = null,
    name: String? = null,
    imageLocal: String? = null,
    imageUrl: String? = null,
    setImgUrl: String? = null,
    owns: Boolean = false,
): PriceAlert = PriceAlert(
    setNumber = setNumber,
    condition = condition,
    direction = direction,
    threshold = threshold,
    currencyCode = currencyCode,
    triggered = triggered,
    lastTriggeredAt = lastTriggeredAt,
    lastPrice = lastPrice,
    name = name,
    imageLocal = imageLocal,
    imageUrl = imageUrl,
    setImgUrl = setImgUrl,
    owns = owns,
)

fun testPriceAlertResponse(
    success: Boolean = false,
    alert: PriceAlert? = null,
    removed: Int = 0,
): PriceAlertResponse = PriceAlertResponse(
    success = success,
    alert = alert,
    removed = removed,
)

fun testPriceAlertsResponse(
    success: Boolean = false,
    alerts: List<PriceAlert> = emptyList(),
): PriceAlertsResponse = PriceAlertsResponse(
    success = success,
    alerts = alerts,
)

fun testPriceChartData(
    values: List<PriceChartSeries> = emptyList(),
    x: List<String> = emptyList(),
): PriceChartData = PriceChartData(
    values = values,
    x = x,
)

fun testPriceChartPoint(
    x: String = "",
    y: Double = 0.0,
): PriceChartPoint = PriceChartPoint(
    x = x,
    y = y,
)

fun testPriceChartSeries(
    name: String = "",
    values: List<PriceChartPoint> = emptyList(),
    firstRealIndex: Int = 0,
): PriceChartSeries = PriceChartSeries(
    name = name,
    values = values,
    firstRealIndex = firstRealIndex,
)

fun testPriceHistoryPoint(
    isPurchasePrice: Boolean = false,
    recordedAt: String = "",
    qtyAvgPrice: Double? = null,
    avgPrice: Double? = null,
    minPrice: Double? = null,
    maxPrice: Double? = null,
): PriceHistoryPoint = PriceHistoryPoint(
    isPurchasePrice = isPurchasePrice,
    recordedAt = recordedAt,
    qtyAvgPrice = qtyAvgPrice,
    avgPrice = avgPrice,
    minPrice = minPrice,
    maxPrice = maxPrice,
)

fun testPriceHistoryResponse(
    condition: String? = null,
    current: JsonElement? = null,
    success: Boolean = false,
    setNumber: String = "",
    currency: CurrencyCode = CurrencyCode.NONE,
    historyNew: List<PriceHistoryPoint> = emptyList(),
    historyUsed: List<PriceHistoryPoint> = emptyList(),
    byCondition: PriceByCondition = PriceByCondition(),
    chart: PriceChartData = testPriceChartData(),
    pnlPct: String? = null,
    pnlPercent: Double? = null,
    purchasePrice: Double? = null,
): PriceHistoryResponse = PriceHistoryResponse(
    condition = condition,
    current = current,
    success = success,
    setNumber = setNumber,
    currency = currency,
    historyNew = historyNew,
    historyUsed = historyUsed,
    byCondition = byCondition,
    chart = chart,
    pnlPct = pnlPct,
    pnlPercent = pnlPercent,
    purchasePrice = purchasePrice,
)

fun testPriceJobState(
    success: Boolean = false,
    job: PriceJobStateJob = testPriceJobStateJob(),
    rateLimit: PriceJobStateRateLimit = testPriceJobStateRateLimit(),
): PriceJobState = PriceJobState(
    success = success,
    job = job,
    rateLimit = rateLimit,
)

fun testPriceJobStateJob(
    running: Boolean = false,
    lastRun: String? = null,
    nextRun: String? = null,
    lastErrors: Int = 0,
    log: List<JsonElement?> = emptyList(),
    lastDuration: Double? = null,
    lastUpdated: Double? = null,
    progress: PriceJobStateJobProgress? = null,
): PriceJobStateJob = PriceJobStateJob(
    running = running,
    lastRun = lastRun,
    nextRun = nextRun,
    lastErrors = lastErrors,
    log = log,
    lastDuration = lastDuration,
    lastUpdated = lastUpdated,
    progress = progress,
)

fun testPriceJobStateJobProgress(
    current: JsonElement? = null,
    total: JsonElement? = null,
    set: JsonElement? = null,
): PriceJobStateJobProgress = PriceJobStateJobProgress(
    current = current,
    total = total,
    set = set,
)

fun testPriceJobStateRateLimit(
    count: Int = 0,
    limit: Int = 0,
    remaining: Int = 0,
    date: String? = null,
): PriceJobStateRateLimit = PriceJobStateRateLimit(
    count = count,
    limit = limit,
    remaining = remaining,
    date = date,
)

fun testProfile(
    id: Int = 0,
    username: String = "",
    email: String? = null,
    firstName: String? = null,
    lastName: String? = null,
    emailVerified: Boolean = false,
    newEmail: String? = null,
): Profile = Profile(
    id = id,
    username = username,
    email = email,
    firstName = firstName,
    lastName = lastName,
    emailVerified = emailVerified,
    newEmail = newEmail,
)

fun testProfileResponse(
    success: Boolean = false,
    user: Profile? = null,
    error: String? = null,
): ProfileResponse = ProfileResponse(
    success = success,
    user = user,
    error = error,
)

fun testProfileSavedResponse(
    success: Boolean = false,
    emailChanged: Boolean? = null,
    emailSent: Boolean? = null,
): ProfileSavedResponse = ProfileSavedResponse(
    success = success,
    emailChanged = emailChanged,
    emailSent = emailSent,
)

fun testQrMessage(
    success: Boolean = false,
    waiting: Boolean = false,
    pickup: String = "",
    code: String = "",
    expiresIn: Int = 0,
): QrMessage = QrMessage(
    success = success,
    waiting = waiting,
    pickup = pickup,
    code = code,
    expiresIn = expiresIn,
)

fun testQrPairingState(
    success: Boolean = false,
    state: String = "",
    device: String? = null,
    ipRange: String? = null,
): QrPairingState = QrPairingState(
    success = success,
    state = state,
    device = device,
    ipRange = ipRange,
)

fun testQrPickup(
    success: Boolean = false,
    token: String? = null,
    user: User? = null,
    error: String? = null,
    secondFactor: Boolean = false,
    neverExpires: Boolean = false,
    tokenInfo: TokenInfo? = null,
    waiting: Boolean = false,
    username: String? = null,
    isAdmin: Boolean = false,
    userId: Int = 0,
    preview: Boolean = false,
    keyNonce: String? = null,
): QrPickup = QrPickup(
    success = success,
    token = token,
    user = user,
    error = error,
    secondFactor = secondFactor,
    neverExpires = neverExpires,
    tokenInfo = tokenInfo,
    waiting = waiting,
    username = username,
    isAdmin = isAdmin,
    userId = userId,
    preview = preview,
    keyNonce = keyNonce,
)

fun testQrToken(
    success: Boolean = false,
    token: String = "",
    pairing: Int = 0,
    expiresIn: Int = 0,
    url: String = "",
    tokenDays: Int? = null,
    fp: String = "",
    certSha256: String = "",
): QrToken = QrToken(
    success = success,
    token = token,
    pairing = pairing,
    expiresIn = expiresIn,
    url = url,
    tokenDays = tokenDays,
    fp = fp,
    certSha256 = certSha256,
)

fun testQuantityChanged(
    success: Boolean = false,
    quantity: Int? = null,
    trash: Int = 0,
    degraded: List<String> = emptyList(),
    dropped: List<QuantityChangedDroppedEntry> = emptyList(),
): QuantityChanged = QuantityChanged(
    success = success,
    quantity = quantity,
    trash = trash,
    degraded = degraded,
    dropped = dropped,
)

fun testQuantityChangedDroppedEntry(
    id: Int = 0,
    quantity: Int = 0,
    purchasePrice: Double? = null,
    currency: String? = null,
    priceEstimated: Boolean = false,
    condition: String = "",
    date: String? = null,
): QuantityChangedDroppedEntry = QuantityChangedDroppedEntry(
    id = id,
    quantity = quantity,
    purchasePrice = purchasePrice,
    currency = currency,
    priceEstimated = priceEstimated,
    condition = condition,
    date = date,
)

fun testRateLimit(
    date: String? = null,
    count: Int = 0,
    limit: Int = 0,
    remaining: Int = 0,
): RateLimit = RateLimit(
    date = date,
    count = count,
    limit = limit,
    remaining = remaining,
)

fun testRateLimits(
    bricklink: RateLimit = testRateLimit(),
    rebrickable: RateLimit = testRateLimit(),
    brickset: RateLimit = testRateLimit(),
): RateLimits = RateLimits(
    bricklink = bricklink,
    rebrickable = rebrickable,
    brickset = brickset,
)

fun testRawSettings(
    success: Boolean = false,
    settings: Map<String, String> = emptyMap(),
): RawSettings = RawSettings(
    success = success,
    settings = settings,
)

fun testRegisterResponse(
    success: Boolean = false,
    message: String = "",
    emailSent: Boolean = false,
    consoleMode: Boolean = false,
    error: String? = null,
): RegisterResponse = RegisterResponse(
    success = success,
    message = message,
    emailSent = emailSent,
    consoleMode = consoleMode,
    error = error,
)

fun testRegistrationStatusResponse(
    enabled: Boolean = false,
    passkey: Boolean = false,
    forgotPassword: Boolean = false,
    mailDelivery: Boolean = false,
): RegistrationStatusResponse = RegistrationStatusResponse(
    enabled = enabled,
    passkey = passkey,
    forgotPassword = forgotPassword,
    mailDelivery = mailDelivery,
)

fun testRestored(
    success: Boolean = false,
    type: String = "",
    number: String = "",
    userId: Int = 0,
): Restored = Restored(
    success = success,
    type = type,
    number = number,
    userId = userId,
)

fun testSecondFactorCodes(
    success: Boolean = false,
    codes: List<String> = emptyList(),
    error: String? = null,
): SecondFactorCodes = SecondFactorCodes(
    success = success,
    codes = codes,
    error = error,
)

fun testSecondFactorSetupResponse(
    success: Boolean = false,
    secret: String? = null,
    otpauth: String? = null,
    error: String? = null,
): SecondFactorSetupResponse = SecondFactorSetupResponse(
    success = success,
    secret = secret,
    otpauth = otpauth,
    error = error,
)

fun testSecondFactorStateResponse(
    success: Boolean = false,
    active: Boolean = false,
    codesLeft: Int = 0,
    oldCodesUntil: String? = null,
    error: String? = null,
): SecondFactorStateResponse = SecondFactorStateResponse(
    success = success,
    active = active,
    codesLeft = codesLeft,
    oldCodesUntil = oldCodesUntil,
    error = error,
)

fun testSeparatedAccount(
    id: Int = 0,
    username: String = "",
    via: String? = null,
): SeparatedAccount = SeparatedAccount(
    id = id,
    username = username,
    via = via,
)

fun testSetAggregate(
    setNumber: String = "",
    condition: Condition = Condition.NEW,
    acqCount: Int = 0,
    usedCount: Int = 0,
    conditions: List<Condition> = emptyList(),
    maxPurchasePrice: Double? = null,
    avgPurchasePrice: Double? = null,
): SetAggregate = SetAggregate(
    setNumber = setNumber,
    condition = condition,
    acqCount = acqCount,
    usedCount = usedCount,
    conditions = conditions,
    maxPurchasePrice = maxPurchasePrice,
    avgPurchasePrice = avgPurchasePrice,
)

fun testSetExistsResponse(
    success: Boolean = false,
    exists: Boolean = false,
    setNumber: String = "",
    ownerUserId: Int? = null,
    isSelf: Boolean = false,
): SetExistsResponse = SetExistsResponse(
    success = success,
    exists = exists,
    setNumber = setNumber,
    ownerUserId = ownerUserId,
    isSelf = isSelf,
)

fun testSetInfoResponse(
    imageLocal: String? = null,
    imageUrl: String? = null,
    minifigs: Int? = null,
    pieces: Int? = null,
    theme: String? = null,
    year: Int? = null,
    success: Boolean = false,
    setNumber: String = "",
    name: String? = null,
    inCatalog: Boolean = false,
): SetInfoResponse = SetInfoResponse(
    imageLocal = imageLocal,
    imageUrl = imageUrl,
    minifigs = minifigs,
    pieces = pieces,
    theme = theme,
    year = year,
    success = success,
    setNumber = setNumber,
    name = name,
    inCatalog = inCatalog,
)

fun testSetItem(
    acqCount: Int = 0,
    lastPurchase: String? = null,
    ownerIds: List<Int> = emptyList(),
    id: Int = 0,
    storageId: Int? = null,
    updatedAt: String? = null,
    userId: Int = 0,
    setNumber: String = "",
    name: String? = null,
    year: Int? = null,
    theme: String? = null,
    pieces: Int? = null,
    minifigs: Int? = null,
    quantity: Int = 0,
    imageUrl: String? = null,
    imageLocal: String? = null,
    addedAt: String? = null,
    condition: Condition? = null,
    storage: String? = null,
    conditions: List<Condition> = emptyList(),
    owners: List<AccountName> = emptyList(),
    maxPurchasePrice: Double? = null,
    avgPurchasePrice: Double? = null,
    purchasePriceEstimated: Boolean? = null,
    usedCount: Int = 0,
    instructions: List<Instruction> = emptyList(),
    bricklink: BrickLinkRef? = null,
    priceComparisonUrl: String? = null,
): SetItem = SetItem(
    acqCount = acqCount,
    lastPurchase = lastPurchase,
    ownerIds = ownerIds,
    id = id,
    storageId = storageId,
    updatedAt = updatedAt,
    userId = userId,
    setNumber = setNumber,
    name = name,
    year = year,
    theme = theme,
    pieces = pieces,
    minifigs = minifigs,
    quantity = quantity,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    addedAt = addedAt,
    condition = condition,
    storage = storage,
    conditions = conditions,
    owners = owners,
    maxPurchasePrice = maxPurchasePrice,
    avgPurchasePrice = avgPurchasePrice,
    purchasePriceEstimated = purchasePriceEstimated,
    usedCount = usedCount,
    instructions = instructions,
    bricklink = bricklink,
    priceComparisonUrl = priceComparisonUrl,
)

fun testSetPriceResponse(
    fromCache: Boolean = false,
    success: Boolean = false,
    setNumber: String = "",
    currency: CurrencyCode = CurrencyCode.NONE,
    avgPrice: Double? = null,
    minPrice: Double? = null,
    maxPrice: Double? = null,
    qtyAvgPrice: Double? = null,
    noPrice: Boolean = false,
    error: String = "",
): SetPriceResponse = SetPriceResponse(
    fromCache = fromCache,
    success = success,
    setNumber = setNumber,
    currency = currency,
    avgPrice = avgPrice,
    minPrice = minPrice,
    maxPrice = maxPrice,
    qtyAvgPrice = qtyAvgPrice,
    noPrice = noPrice,
    error = error,
)

fun testSetResponse(
    success: Boolean = false,
    set: SetItem? = null,
): SetResponse = SetResponse(
    success = success,
    set = set,
)

fun testSetsResponse(
    success: Boolean = false,
    count: Int = 0,
    sets: List<SetItem> = emptyList(),
    total: Int = 0,
    themes: List<String> = emptyList(),
): SetsResponse = SetsResponse(
    success = success,
    count = count,
    sets = sets,
    total = total,
    themes = themes,
)

fun testSettingsResponse(
    success: Boolean = false,
    settings: UserSettings = testUserSettings(),
): SettingsResponse = SettingsResponse(
    success = success,
    settings = settings,
)

fun testSetup(
    success: Boolean = false,
    open: Boolean = false,
    changePassword: Boolean = false,
    sources: SetupSources = testSetupSources(),
): Setup = Setup(
    success = success,
    open = open,
    changePassword = changePassword,
    sources = sources,
)

fun testSetupSources(
    rebrickable: Boolean = false,
    bricklink: Boolean = false,
    brickset: Boolean = false,
): SetupSources = SetupSources(
    rebrickable = rebrickable,
    bricklink = bricklink,
    brickset = brickset,
)

fun testSetupState(
    success: Boolean = false,
    done: Boolean = false,
    configured: Boolean = false,
    steps: List<SetupStateStepsEntry> = emptyList(),
    ca: SetupStateCa = testSetupStateCa(),
    baseUrl: String? = null,
    https: Boolean = false,
    degraded: List<String> = emptyList(),
): SetupState = SetupState(
    success = success,
    done = done,
    configured = configured,
    steps = steps,
    ca = ca,
    baseUrl = baseUrl,
    https = https,
    degraded = degraded,
)

fun testSetupStateCa(
    existing: Boolean = false,
    fpHex: String = "",
    certSha256: String = "",
    validUntil: String = "",
    download: String = "",
): SetupStateCa = SetupStateCa(
    existing = existing,
    fpHex = fpHex,
    certSha256 = certSha256,
    validUntil = validUntil,
    download = download,
)

fun testSetupStateStepsEntry(
    id: String = "",
    ok: Boolean = false,
    required: Boolean = false,
): SetupStateStepsEntry = SetupStateStepsEntry(
    id = id,
    ok = ok,
    required = required,
)

fun testSmtpProbe(
    mode: String? = null,
    success: Boolean = false,
): SmtpProbe = SmtpProbe(
    mode = mode,
    success = success,
)

fun testStartupStatus(
    error: String? = null,
    path: String? = null,
    ready: Boolean = false,
    step: String? = null,
    progress: Double = 0.0,
    total: Int = 0,
    sub: String? = null,
): StartupStatus = StartupStatus(
    error = error,
    path = path,
    ready = ready,
    step = step,
    progress = progress,
    total = total,
    sub = sub,
)

fun testStatsResponse(
    success: Boolean = false,
    stats: DashboardStats? = null,
): StatsResponse = StatsResponse(
    success = success,
    stats = stats,
)

fun testStepApprovalResponse(
    success: Boolean = false,
    action: String = "",
    validUntil: String = "",
): StepApprovalResponse = StepApprovalResponse(
    success = success,
    action = action,
    validUntil = validUntil,
)

fun testStepChallengeResponse(
    success: Boolean = false,
    challenge: String = "",
    message: String = "",
    validUntil: String = "",
): StepChallengeResponse = StepChallengeResponse(
    success = success,
    challenge = challenge,
    message = message,
    validUntil = validUntil,
)

fun testStorage(
    minifigs: Int? = null,
    location: String = "",
    sets: Int = 0,
    parts: Int = 0,
): Storage = Storage(
    minifigs = minifigs,
    location = location,
    sets = sets,
    parts = parts,
)

fun testStorageDefaultResponse(
    success: Boolean = false,
    preset: StorageEntry? = null,
): StorageDefaultResponse = StorageDefaultResponse(
    success = success,
    preset = preset,
)

fun testStorageEntry(
    id: Int = 0,
    userId: Int = 0,
    name: String = "",
): StorageEntry = StorageEntry(
    id = id,
    userId = userId,
    name = name,
)

fun testStorageEntryResponse(
    success: Boolean = false,
    location: StorageEntry? = null,
): StorageEntryResponse = StorageEntryResponse(
    success = success,
    location = location,
)

fun testStorageResponse(
    success: Boolean = false,
    storage: String? = null,
    changed: Int = 0,
): StorageResponse = StorageResponse(
    success = success,
    storage = storage,
    changed = changed,
)

fun testStorageStockResponse(
    success: Boolean = false,
    locations: List<StorageEntry> = emptyList(),
    preset: StorageEntry? = null,
): StorageStockResponse = StorageStockResponse(
    success = success,
    locations = locations,
    preset = preset,
)

fun testStoragesResponse(
    success: Boolean = false,
    locations: List<Storage> = emptyList(),
): StoragesResponse = StoragesResponse(
    success = success,
    locations = locations,
)

fun testTlsState(
    success: Boolean = false,
    https: Boolean = false,
    fp: String? = null,
    fpHex: String = "",
    certSha256: String = "",
    subject: String = "",
    validUntil: String = "",
    download: String = "",
): TlsState = TlsState(
    success = success,
    https = https,
    fp = fp,
    fpHex = fpHex,
    certSha256 = certSha256,
    subject = subject,
    validUntil = validUntil,
    download = download,
)

fun testTokenCreated(
    success: Boolean = false,
    token: String = "",
    label: String? = null,
    neverExpires: Boolean = false,
    tokenInfo: TokenInfo? = null,
): TokenCreated = TokenCreated(
    success = success,
    token = token,
    label = label,
    neverExpires = neverExpires,
    tokenInfo = tokenInfo,
)

fun testTokenInfo(
    scope: String = "",
    expiresAt: String? = null,
    hardExpiresAt: String? = null,
    neverExpires: Boolean = false,
    rotatedAt: String? = null,
    rotationDue: Boolean = false,
): TokenInfo = TokenInfo(
    scope = scope,
    expiresAt = expiresAt,
    hardExpiresAt = hardExpiresAt,
    neverExpires = neverExpires,
    rotatedAt = rotatedAt,
    rotationDue = rotationDue,
)

fun testTokenRevocation(
    success: Boolean = false,
    deleted: Int = 0,
): TokenRevocation = TokenRevocation(
    success = success,
    deleted = deleted,
)

fun testTokenRotation(
    success: Boolean = false,
    token: String? = null,
    tokenInfo: TokenInfo? = null,
    oldValidUntil: String? = null,
    overlapSeconds: Int? = null,
): TokenRotation = TokenRotation(
    success = success,
    token = token,
    tokenInfo = tokenInfo,
    oldValidUntil = oldValidUntil,
    overlapSeconds = overlapSeconds,
)

fun testTokensResponse(
    success: Boolean = false,
    tokens: List<AppToken> = emptyList(),
    error: String? = null,
): TokensResponse = TokensResponse(
    success = success,
    tokens = tokens,
    error = error,
)

fun testTotals(
    min: String = "",
    avg: String = "",
    max: String = "",
    qtyAvg: String = "",
): Totals = Totals(
    min = min,
    avg = avg,
    max = max,
    qtyAvg = qtyAvg,
)

fun testTrash(
    success: Boolean = false,
    entries: List<TrashEntry> = emptyList(),
): Trash = Trash(
    success = success,
    entries = entries,
)

fun testTrashEmptied(
    success: Boolean = false,
    removed: Int = 0,
): TrashEmptied = TrashEmptied(
    success = success,
    removed = removed,
)

fun testTrashEntry(
    id: Int = 0,
    type: String = "",
    number: String = "",
    colorId: Int? = null,
    label: String? = null,
    count: Int = 0,
    userId: Int = 0,
    deletedAt: String = "",
    purgeAt: String = "",
): TrashEntry = TrashEntry(
    id = id,
    type = type,
    number = number,
    colorId = colorId,
    label = label,
    count = count,
    userId = userId,
    deletedAt = deletedAt,
    purgeAt = purgeAt,
)

fun testUser(
    id: Int = 0,
    username: String = "",
    isAdmin: Boolean = false,
    mustChangePassword: Boolean = false,
    secondFactorRequired: Boolean = false,
): User = User(
    id = id,
    username = username,
    isAdmin = isAdmin,
    mustChangePassword = mustChangePassword,
    secondFactorRequired = secondFactorRequired,
)

fun testUserSettings(
    currency: CurrencyCode = CurrencyCode.NONE,
    priceCondition: Condition = Condition.NEW,
    priceCacheTtl: String = "",
    defaultPriceCondition: Condition = Condition.NEW,
    userDefaultCondition: Condition? = null,
    effectiveCondition: Condition = Condition.NEW,
    appTheme: Design? = null,
    removeEmptyVouchers: Boolean = false,
): UserSettings = UserSettings(
    currency = currency,
    priceCondition = priceCondition,
    priceCacheTtl = priceCacheTtl,
    defaultPriceCondition = defaultPriceCondition,
    userDefaultCondition = userDefaultCondition,
    effectiveCondition = effectiveCondition,
    appTheme = appTheme,
    removeEmptyVouchers = removeEmptyVouchers,
)

fun testUsingSet(
    setNumber: String = "",
    setName: String? = null,
    quantity: Int = 0,
    imageLocal: String? = null,
    imageUrl: String? = null,
    ownerUserId: Int = 0,
): UsingSet = UsingSet(
    setNumber = setNumber,
    setName = setName,
    quantity = quantity,
    imageLocal = imageLocal,
    imageUrl = imageUrl,
    ownerUserId = ownerUserId,
)

fun testUsingSetsResponse(
    success: Boolean = false,
    item: ComponentHeader? = null,
    sets: List<UsingSet> = emptyList(),
): UsingSetsResponse = UsingSetsResponse(
    success = success,
    item = item,
    sets = sets,
)

fun testValuationAcquisition(
    id: Int = 0,
    condition: Condition = Condition.NEW,
    quantity: Int = 0,
    purchasePrice: Double? = null,
    avgPrice: Double? = null,
    totalAvg: String? = null,
    valueTotal: Double? = null,
    pnlPct: String? = null,
    pnlPercent: Double? = null,
    createdAt: String? = null,
    originalPurchasePrice: Double = 0.0,
    purchaseCurrency: String = "",
    priceEstimated: Boolean = false,
): ValuationAcquisition = ValuationAcquisition(
    id = id,
    condition = condition,
    quantity = quantity,
    purchasePrice = purchasePrice,
    avgPrice = avgPrice,
    totalAvg = totalAvg,
    valueTotal = valueTotal,
    pnlPct = pnlPct,
    pnlPercent = pnlPercent,
    createdAt = createdAt,
    originalPurchasePrice = originalPurchasePrice,
    purchaseCurrency = purchaseCurrency,
    priceEstimated = priceEstimated,
)

fun testValuationResponse(
    convertedPurchasePrices: Int = 0,
    guideType: String = "",
    ttlHours: JsonElement? = null,
    success: Boolean = false,
    total: Int = 0,
    page: Int = 0,
    pageSize: Int = 0,
    totalValue: String = "",
    valueTotal: Double? = null,
    pricesPending: Int = 0,
    currency: CurrencyCode = CurrencyCode.NONE,
    condition: Condition = Condition.NEW,
    cacheTtlHours: Int = 0,
    foreignCurrencyPurchases: Int = 0,
    sets: List<ValuationSet> = emptyList(),
    totals: Totals = testTotals(),
): ValuationResponse = ValuationResponse(
    convertedPurchasePrices = convertedPurchasePrices,
    guideType = guideType,
    ttlHours = ttlHours,
    success = success,
    total = total,
    page = page,
    pageSize = pageSize,
    totalValue = totalValue,
    valueTotal = valueTotal,
    pricesPending = pricesPending,
    currency = currency,
    condition = condition,
    cacheTtlHours = cacheTtlHours,
    foreignCurrencyPurchases = foreignCurrencyPurchases,
    sets = sets,
    totals = totals,
)

fun testValuationSet(
    blUnknown: Boolean = false,
    condition: String = "",
    conditions: List<String> = emptyList(),
    errorCode: String? = null,
    pnlPct: String? = null,
    userId: Int = 0,
    setNumber: String = "",
    addedAt: String? = null,
    name: String? = null,
    year: Int? = null,
    quantity: Int = 0,
    imageLocal: String? = null,
    imageUrl: String? = null,
    minPrice: Double? = null,
    avgPrice: Double? = null,
    maxPrice: Double? = null,
    qtyAvgPrice: Double? = null,
    totalQtyAvg: String? = null,
    pricePending: Boolean = false,
    totalAvg: String? = null,
    valueTotal: Double? = null,
    pnlPercent: Double? = null,
    purchasePrice: Double? = null,
    fromCache: Boolean = false,
    isFallback: Boolean = false,
    conditionUsed: Condition? = null,
    noPrice: Boolean = false,
    acquisitions: List<ValuationAcquisition> = emptyList(),
    mixed: Boolean = false,
    owners: List<AccountName> = emptyList(),
    error: String? = null,
): ValuationSet = ValuationSet(
    blUnknown = blUnknown,
    condition = condition,
    conditions = conditions,
    errorCode = errorCode,
    pnlPct = pnlPct,
    userId = userId,
    setNumber = setNumber,
    addedAt = addedAt,
    name = name,
    year = year,
    quantity = quantity,
    imageLocal = imageLocal,
    imageUrl = imageUrl,
    minPrice = minPrice,
    avgPrice = avgPrice,
    maxPrice = maxPrice,
    qtyAvgPrice = qtyAvgPrice,
    totalQtyAvg = totalQtyAvg,
    pricePending = pricePending,
    totalAvg = totalAvg,
    valueTotal = valueTotal,
    pnlPercent = pnlPercent,
    purchasePrice = purchasePrice,
    fromCache = fromCache,
    isFallback = isFallback,
    conditionUsed = conditionUsed,
    noPrice = noPrice,
    acquisitions = acquisitions,
    mixed = mixed,
    owners = owners,
    error = error,
)

fun testVoucher(
    id: Int = 0,
    number: String = "",
    pin: String? = null,
    amount: Double = 0.0,
    currency: CurrencyCode = CurrencyCode.NONE,
    hasPdf: Boolean = false,
    createdAt: String = "",
    updatedAt: String = "",
    balanceCheckedAt: String? = null,
): Voucher = Voucher(
    id = id,
    number = number,
    pin = pin,
    amount = amount,
    currency = currency,
    hasPdf = hasPdf,
    createdAt = createdAt,
    updatedAt = updatedAt,
    balanceCheckedAt = balanceCheckedAt,
)

fun testVoucherBatch(
    results: List<JsonElement?> = emptyList(),
    added: Int = 0,
    updated: Int = 0,
    errors: Int = 0,
    total: Int = 0,
): VoucherBatch = VoucherBatch(
    results = results,
    added = added,
    updated = updated,
    errors = errors,
    total = total,
)

fun testVoucherList(
    success: Boolean = false,
    total: Int = 0,
    page: Int = 0,
    pageSize: Int = 0,
    vouchers: List<Voucher> = emptyList(),
): VoucherList = VoucherList(
    success = success,
    total = total,
    page = page,
    pageSize = pageSize,
    vouchers = vouchers,
)

fun testVoucherPdfGrant(
    success: Boolean = false,
    ticket: String = "",
    validSeconds: Int = 0,
): VoucherPdfGrant = VoucherPdfGrant(
    success = success,
    ticket = ticket,
    validSeconds = validSeconds,
)

fun testVoucherPlaintext(
    success: Boolean = false,
    id: Int = 0,
    number: String = "",
    pin: String? = null,
): VoucherPlaintext = VoucherPlaintext(
    success = success,
    id = id,
    number = number,
    pin = pin,
)

fun testVoucherReply(
    success: Boolean = false,
    voucher: Voucher? = null,
    multiple: VoucherBatch? = null,
    parsed: ParsedVoucher? = null,
    error: String? = null,
    code: String? = null,
): VoucherReply = VoucherReply(
    success = success,
    voucher = voucher,
    multiple = multiple,
    parsed = parsed,
    error = error,
    code = code,
)

fun testWantedItem(
    themeId: Int? = null,
    setNumber: String = "",
    condition: Condition = Condition.NEW,
    createdAt: String = "",
    userId: Int = 0,
    name: String? = null,
    year: Int? = null,
    numParts: Int? = null,
    imageUrl: String? = null,
    imageLocal: String? = null,
    marketPrice: Double? = null,
    currency: CurrencyCode = CurrencyCode.NONE,
    owned: Boolean = false,
    alarm: WantedItemAlert? = null,
    priceComparisonUrl: String? = null,
): WantedItem = WantedItem(
    themeId = themeId,
    setNumber = setNumber,
    condition = condition,
    createdAt = createdAt,
    userId = userId,
    name = name,
    year = year,
    numParts = numParts,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    marketPrice = marketPrice,
    currency = currency,
    owned = owned,
    alarm = alarm,
    priceComparisonUrl = priceComparisonUrl,
)

fun testWantedItemAlert(
    direction: AlarmDirection = AlarmDirection.BELOW,
    threshold: Double = 0.0,
    triggered: Boolean = false,
): WantedItemAlert = WantedItemAlert(
    direction = direction,
    threshold = threshold,
    triggered = triggered,
)

fun testWantedItemOwnerReply(
    success: Boolean = false,
    moved: Boolean = false,
    merged: Boolean = false,
    ownerUserId: Int? = null,
): WantedItemOwnerReply = WantedItemOwnerReply(
    success = success,
    moved = moved,
    merged = merged,
    ownerUserId = ownerUserId,
)

fun testWantedItemPricesResponse(
    success: Boolean = false,
    setNumber: String = "",
    currency: CurrencyCode = CurrencyCode.NONE,
    current: CurrentByCondition = CurrentByCondition(),
    degraded: List<String> = emptyList(),
): WantedItemPricesResponse = WantedItemPricesResponse(
    success = success,
    setNumber = setNumber,
    currency = currency,
    current = current,
    degraded = degraded,
)

fun testWantedItemReply(
    success: Boolean = false,
    wasNew: Boolean = false,
    item: WantedItem? = null,
): WantedItemReply = WantedItemReply(
    success = success,
    wasNew = wasNew,
    item = item,
)

fun testWantedItemTakeoverResponse(
    catalogPending: Boolean = false,
    name: String? = null,
    success: Boolean = false,
    action: String? = null,
    setNumber: String? = null,
): WantedItemTakeoverResponse = WantedItemTakeoverResponse(
    catalogPending = catalogPending,
    name = name,
    success = success,
    action = action,
    setNumber = setNumber,
)

fun testWantedListResponse(
    success: Boolean = false,
    total: Int = 0,
    page: Int = 0,
    pageSize: Int = 0,
    item: List<WantedItem> = emptyList(),
): WantedListResponse = WantedListResponse(
    success = success,
    total = total,
    page = page,
    pageSize = pageSize,
    item = item,
)

fun testWantedXmlResult(
    success: Boolean = false,
    preview: Boolean = false,
    parsed: Int = 0,
    created: Int = 0,
    toppedUp: Int = 0,
    failed: Int = 0,
    items: List<WantedXmlResultItemsEntry> = emptyList(),
    open: List<WantedXmlResultOpenEntry> = emptyList(),
    foreignTypes: Map<String, Int> = emptyMap(),
    withoutNumber: Int = 0,
    levels: Map<String, Int> = emptyMap(),
    colorPending: Int = 0,
    defaultCondition: String = "",
    aborted: Boolean = false,
    corrections: WantedXmlResultCorrections? = null,
    rebrickable: WantedXmlResultRebrickable? = null,
): WantedXmlResult = WantedXmlResult(
    success = success,
    preview = preview,
    parsed = parsed,
    created = created,
    toppedUp = toppedUp,
    failed = failed,
    items = items,
    open = open,
    foreignTypes = foreignTypes,
    withoutNumber = withoutNumber,
    levels = levels,
    colorPending = colorPending,
    defaultCondition = defaultCondition,
    aborted = aborted,
    corrections = corrections,
    rebrickable = rebrickable,
)

fun testWantedXmlResultCorrections(
    applied: Int = 0,
    rejected: List<JsonElement?> = emptyList(),
): WantedXmlResultCorrections = WantedXmlResultCorrections(
    applied = applied,
    rejected = rejected,
)

fun testWantedXmlResultItemsEntry(
    kind: String = "",
    blId: String = "",
    quantity: Int = 0,
    outcome: String = "",
    blColor: Int? = null,
    rbId: String? = null,
    rbColor: Int? = null,
    colorName: String? = null,
    colorHex: String? = null,
    confidence: String? = null,
    condition: String? = null,
    maxPrice: Double? = null,
    name: String? = null,
    nameGuessed: Boolean = false,
    image: String? = null,
    reason: String? = null,
    reasonCode: String? = null,
): WantedXmlResultItemsEntry = WantedXmlResultItemsEntry(
    kind = kind,
    blId = blId,
    quantity = quantity,
    outcome = outcome,
    blColor = blColor,
    rbId = rbId,
    rbColor = rbColor,
    colorName = colorName,
    colorHex = colorHex,
    confidence = confidence,
    condition = condition,
    maxPrice = maxPrice,
    name = name,
    nameGuessed = nameGuessed,
    image = image,
    reason = reason,
    reasonCode = reasonCode,
)

fun testWantedXmlResultOpenEntry(
    kind: String = "",
    blId: String = "",
    blColor: Int? = null,
): WantedXmlResultOpenEntry = WantedXmlResultOpenEntry(
    kind = kind,
    blId = blId,
    blColor = blColor,
)

fun testWantedXmlResultRebrickable(
    asked: Int = 0,
    found: Int = 0,
    filterIneffective: Boolean = false,
    aborted: String = "",
): WantedXmlResultRebrickable = WantedXmlResultRebrickable(
    asked = asked,
    found = found,
    filterIneffective = filterIneffective,
    aborted = aborted,
)

fun testYearCount(
    year: Int? = null,
    n: Int = 0,
): YearCount = YearCount(
    year = year,
    n = n,
)
