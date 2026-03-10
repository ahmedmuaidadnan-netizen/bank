import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { isSupabaseConfigured, supabase } from './lib/supabaseClient'

const CURRENT_MEMBER_NAME_KEY = 'zahra_current_member_name'
const LEGACY_MEMBER_PHONE_KEY = 'zahra_current_member_phone'
const ADMIN_SESSION_KEY = 'zahra_admin_session'
const SESSION_PASSWORD_KEY = 'zahra_session_password'
const PERSISTED_PASSWORD_KEY = 'zahra_persisted_password'
const PENDING_COUNTS_KEY = 'zahra_pending_counts'
const PASSWORD_HASH_PREFIX = 'sha256$'

const initialRegisterForm = { fullName: '', country: 'العراق', governorate: '', password: '' }
const initialLoginForm = { fullName: '', password: '' }
const normalizeDisplayName = (name) => name.trim().replace(/\s+/g, ' ').toLowerCase()

const IRAQ_GOVERNORATES = [
  'بغداد',
  'البصرة',
  'نينوى',
  'أربيل',
  'النجف',
  'كربلاء',
  'الأنبار',
  'ذي قار',
  'ديالى',
  'واسط',
  'المثنى',
  'القادسية',
  'بابل',
  'صلاح الدين',
  'كركوك',
  'ميسان',
  'دهوك',
  'السليمانية',
]

const FALLBACK_COUNTRIES = [
  'العراق',
  'السعودية',
  'الكويت',
  'الإمارات',
  'قطر',
  'البحرين',
  'عُمان',
  'الأردن',
  'سوريا',
  'لبنان',
  'مصر',
  'اليمن',
  'تركيا',
  'إيران',
]

const buildWorldCountryOptions = () => {
  try {
    if (
      typeof Intl !== 'undefined' &&
      typeof Intl.DisplayNames === 'function' &&
      typeof Intl.supportedValuesOf === 'function'
    ) {
      const displayNames = new Intl.DisplayNames(['ar'], { type: 'region' })
      const countries = Intl.supportedValuesOf('region')
        .map((code) => displayNames.of(code))
        .filter(Boolean)
      const collator = new Intl.Collator('ar')
      return Array.from(new Set(['العراق', ...countries])).sort((a, b) => collator.compare(a, b))
    }
  } catch {
    // Fallback for older browsers.
  }
  return FALLBACK_COUNTRIES
}

const WORLD_COUNTRY_OPTIONS = buildWorldCountryOptions()

const buildLegacyPhoneFromName = (fullName) => `name:${normalizeDisplayName(fullName)}`

const mapMemberRow = (row) => ({
  id: row.id,
  fullName: row.full_name,
  phone: row.phone,
  country: row.country ?? 'العراق',
  governorate: row.governorate ?? '',
  password: row.password ?? '',
  stats: {
    istighfar: row.istighfar ?? 0,
    salawat: row.salawat ?? 0,
    quranParts: row.quran_parts ?? 0,
  },
})

const mapActivityRow = (row) => ({
  id: row.id,
  memberId: row.member_id,
  deltaIstighfar: row.delta_istighfar ?? 0,
  deltaSalawat: row.delta_salawat ?? 0,
  deltaQuranParts: row.delta_quran_parts ?? 0,
  source: row.source ?? 'member',
  createdAt: row.created_at,
})

const rankBy = (members, metricKey) =>
  [...members].sort((a, b) => b.stats[metricKey] - a.stats[metricKey])

const activityMetricMap = {
  istighfar: 'deltaIstighfar',
  salawat: 'deltaSalawat',
  quranParts: 'deltaQuranParts',
}

const metricDbFieldMap = {
  istighfar: 'istighfar',
  salawat: 'salawat',
  quranParts: 'quran_parts',
}

const competitionConfig = {
  istighfar: {
    title: 'مسابقة الاستغفار',
    buttonText: 'استغفر الله',
    statLabel: 'الاستغفار',
    submitText: 'رفع الاستغفار إلى العدد الكلي',
    tapThresholdMs: 250,
  },
  salawat: {
    title: 'مسابقة الصلاة على النبي',
    buttonText: 'اللَّهُمَّ صَلِّ عَلَى مُحَمَّدٍ آلِ مُحَمَّدٍ',
    statLabel: 'الصلاة على النبي',
    submitText: 'رفع الصلاة إلى العدد الكلي',
    tapThresholdMs: 500,
  },
  quranParts: {
    title: 'مسابقة الختمة الجماعية',
    buttonText: 'حجز جزء',
    statLabel: 'الأجزاء',
    submitText: 'تأكيد حجز الجزء',
  },
}

const QURAN_TOTAL_PARTS = 30
const QURAN_TOTAL_SURAHS = 114
const QURAN_TOTAL_AYAT = 6236
const MAX_PARTS_PER_MEMBER_PER_KHATMA = 5

const createInitialTapGuardState = () => ({
  istighfar: {
    lastTapAt: 0,
    windowStartedAt: 0,
    burstCount: 0,
    lockUntil: 0,
    lastSubmitAt: 0,
    violationLevel: 0,
  },
  salawat: {
    lastTapAt: 0,
    windowStartedAt: 0,
    burstCount: 0,
    lockUntil: 0,
    lastSubmitAt: 0,
    violationLevel: 0,
  },
})

const getPeriodStart = (period) => {
  const now = new Date()
  if (period === 'day') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }
  if (period === 'week') {
    const day = now.getDay()
    const distanceFromMonday = day === 0 ? 6 : day - 1
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - distanceFromMonday)
  }
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

const formatRemainingTime = (remainingMs) => {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) {
    return `${days} يوم ${hours} ساعة ${minutes} دقيقة`
  }
  if (hours > 0) {
    return `${hours} ساعة ${minutes} دقيقة ${seconds} ثانية`
  }
  return `${minutes} دقيقة ${seconds} ثانية`
}

const stringToUtf8 = (value) => new TextEncoder().encode(value)

const bytesToHex = (bytes) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

const hashPassword = async (rawPassword) => {
  const digest = await crypto.subtle.digest('SHA-256', stringToUtf8(rawPassword))
  return `${PASSWORD_HASH_PREFIX}${bytesToHex(new Uint8Array(digest))}`
}

const isHashedPassword = (storedPassword) =>
  typeof storedPassword === 'string' && storedPassword.startsWith(PASSWORD_HASH_PREFIX)

const verifyPassword = async (rawPassword, storedPassword) => {
  if (!storedPassword) return false
  if (isHashedPassword(storedPassword)) {
    const incomingHash = await hashPassword(rawPassword)
    return incomingHash === storedPassword
  }
  return rawPassword === storedPassword
}

const compareWithConfiguredSecret = async (inputPassword, configuredPassword) => {
  if (!configuredPassword) return false
  if (configuredPassword.startsWith(PASSWORD_HASH_PREFIX)) {
    const incomingHash = await hashPassword(inputPassword)
    return incomingHash === configuredPassword
  }
  return inputPassword === configuredPassword
}

const motivationMilestones = [10000, 25000, 50000, 100000, 250000, 500000, 1000000]

const formatArabicNumber = (value) => Number(value || 0).toLocaleString('ar-IQ')
const formatEnglishNumber = (value) => Number(value || 0).toLocaleString('en-US')

const getNextMilestone = (value) => {
  const safeValue = Math.max(0, Number(value) || 0)
  const directTarget = motivationMilestones.find((target) => safeValue < target)
  if (directTarget) return directTarget
  const step = 500000
  return Math.ceil((safeValue + 1) / step) * step
}

const getPreviousMilestone = (target) => {
  const index = motivationMilestones.indexOf(target)
  if (index === -1) {
    return Math.max(0, target - 500000)
  }
  if (index === 0) return 0
  return motivationMilestones[index - 1]
}

const buildMotivationState = (value) => {
  const safeValue = Math.max(0, Number(value) || 0)
  const target = getNextMilestone(safeValue)
  const start = getPreviousMilestone(target)
  const range = Math.max(1, target - start)
  const progressRatio = Math.min(1, Math.max(0, (safeValue - start) / range))
  const remaining = Math.max(0, target - safeValue)
  return { target, start, progressRatio, remaining }
}

const ONE_HOUR_MS = 60 * 60 * 1000

const readPendingStore = () => {
  try {
    const raw = localStorage.getItem(PENDING_COUNTS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

const SiteLogo = ({ size = 26 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    aria-hidden="true"
    focusable="false"
  >
    <g fill="#1ca39d">
      <ellipse cx="32" cy="13" rx="10" ry="12" />
      <ellipse cx="32" cy="51" rx="10" ry="12" />
      <ellipse cx="13" cy="32" rx="12" ry="10" />
      <ellipse cx="51" cy="32" rx="12" ry="10" />
      <ellipse cx="19" cy="19" rx="8" ry="10" transform="rotate(-45 19 19)" />
      <ellipse cx="45" cy="19" rx="8" ry="10" transform="rotate(45 45 19)" />
      <ellipse cx="19" cy="45" rx="8" ry="10" transform="rotate(45 19 45)" />
      <ellipse cx="45" cy="45" rx="8" ry="10" transform="rotate(-45 45 45)" />
    </g>
    <circle cx="32" cy="32" r="9" fill="#0f6e66" />
    <circle cx="32" cy="32" r="4" fill="#d7fff8" />
  </svg>
)

const TasbeehIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="4.5" r="2" fill="#1ca39d" />
    <circle cx="12" cy="10" r="2.1" fill="#1ca39d" />
    <circle cx="12" cy="15.5" r="2.2" fill="#1ca39d" />
    <circle cx="12" cy="21" r="2.3" fill="#1ca39d" />
    <path d="M12 6.5v2M12 12v2M12 17.5v1.2" stroke="#0f6e66" strokeWidth="1.2" />
  </svg>
)

const DomeIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="4" y="15" width="16" height="4.5" rx="1.2" fill="#1ca39d" />
    <path d="M6 15a6 6 0 0 1 12 0Z" fill="#1ca39d" />
    <rect x="11.15" y="5" width="1.7" height="3.3" rx="0.85" fill="#0f6e66" />
    <circle cx="12" cy="4" r="1.2" fill="#0f6e66" />
  </svg>
)

const OpenBookIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M3.5 6.5c2.8-1.1 5.3-1 7.5.2v10.8c-2.2-1.2-4.7-1.3-7.5-.2Z" fill="#1ca39d" />
    <path d="M20.5 6.5c-2.8-1.1-5.3-1-7.5.2v10.8c2.2-1.2 4.7-1.3 7.5-.2Z" fill="#1ca39d" />
    <path d="M12 6.7v10.7" stroke="#0f6e66" strokeWidth="1.2" />
    <path d="M5.3 8.5c1.6-.5 3.1-.4 4.6.2M14.1 8.7c1.5-.6 3-.7 4.6-.2" stroke="#d7fff8" strokeWidth="0.9" />
  </svg>
)

const isNameTaken = (members, candidateName, ignoreMemberId = null) => {
  const normalizedCandidate = normalizeDisplayName(candidateName)
  if (!normalizedCandidate) return false
  return members.some(
    (member) =>
      member.id !== ignoreMemberId && normalizeDisplayName(member.fullName) === normalizedCandidate,
  )
}

function App() {
  const [members, setMembers] = useState([])
  const [authMode, setAuthMode] = useState('login')
  const [registerForm, setRegisterForm] = useState(initialRegisterForm)
  const [loginForm, setLoginForm] = useState(initialLoginForm)
  const [sessionPhone, setSessionPhone] = useState(
    localStorage.getItem(CURRENT_MEMBER_NAME_KEY) ||
      localStorage.getItem(LEGACY_MEMBER_PHONE_KEY) ||
      '',
  )
  const [isAdminSession, setIsAdminSession] = useState(
    localStorage.getItem(ADMIN_SESSION_KEY) === '1',
  )
  const [activities, setActivities] = useState([])
  const [memberSecurity, setMemberSecurity] = useState({})
  const [khatmaParts, setKhatmaParts] = useState([])
  const [khatmaStats, setKhatmaStats] = useState({
    khatmaCount: 0,
    totalPartsRead: 0,
    totalSurahsRead: 0,
    totalAyatRead: 0,
  })
  const [adminSearch, setAdminSearch] = useState('')
  const [adminDrafts, setAdminDrafts] = useState({})
  const [isBooting, setIsBooting] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authSuccess, setAuthSuccess] = useState('')
  const [showRegisterPassword, setShowRegisterPassword] = useState(false)
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [sessionPassword, setSessionPassword] = useState(
    sessionStorage.getItem(SESSION_PASSWORD_KEY) ||
      localStorage.getItem(PERSISTED_PASSWORD_KEY) ||
      '',
  )
  const [liveNow, setLiveNow] = useState(Date.now())
  const [activeCompetition, setActiveCompetition] = useState(null)
  const [pendingCounts, setPendingCounts] = useState({
    istighfar: 0,
    salawat: 0,
    quranParts: 0,
  })
  const [competitionMessage, setCompetitionMessage] = useState('')
  const [tapGuardState, setTapGuardState] = useState(createInitialTapGuardState)
  const [siteNotice, setSiteNotice] = useState({ isOpen: false, message: '' })
  const [isAutoSubmittingPending, setIsAutoSubmittingPending] = useState(false)

  const adminIdentity = normalizeDisplayName(
    import.meta.env.VITE_ADMIN_NAME || import.meta.env.VITE_ADMIN_PHONE || '',
  )
  const adminPassword = (import.meta.env.VITE_ADMIN_PASSWORD || '').trim()
  const adminPasswordHash = (import.meta.env.VITE_ADMIN_PASSWORD_HASH || '').trim()

  const currentMember = useMemo(
    () => members.find((member) => normalizeDisplayName(member.fullName) === sessionPhone) || null,
    [members, sessionPhone],
  )

  const sortedByIstighfar = useMemo(() => rankBy(members, 'istighfar'), [members])
  const sortedBySalawat = useMemo(() => rankBy(members, 'salawat'), [members])
  const sortedByQuranParts = useMemo(() => rankBy(members, 'quranParts'), [members])
  const rankedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      const scoreA = a.stats.istighfar + a.stats.salawat + a.stats.quranParts
      const scoreB = b.stats.istighfar + b.stats.salawat + b.stats.quranParts
      return scoreB - scoreA
    })
  }, [members])
  const filteredAdminMembers = useMemo(() => {
    const query = adminSearch.trim().toLowerCase()
    if (!query) return rankedMembers
    return rankedMembers.filter((member) => {
      return (
        member.fullName.toLowerCase().includes(query) ||
        member.country.toLowerCase().includes(query) ||
        member.governorate.toLowerCase().includes(query)
      )
    })
  }, [rankedMembers, adminSearch])
  const totals = useMemo(() => {
    return members.reduce(
      (acc, member) => {
        acc.istighfar += member.stats.istighfar
        acc.salawat += member.stats.salawat
        acc.quranParts += member.stats.quranParts
        return acc
      },
      { istighfar: 0, salawat: 0, quranParts: 0 },
    )
  }, [members])
  const activeMemberCounts = useMemo(() => {
    const memberIds = new Set(members.map((member) => member.id))
    const dayStart = getPeriodStart('day').getTime()
    const weekStart = getPeriodStart('week').getTime()
    const monthStart = getPeriodStart('month').getTime()

    const daySet = new Set()
    const weekSet = new Set()
    const monthSet = new Set()

    for (const activity of activities) {
      if (!activity?.memberId || !memberIds.has(activity.memberId)) continue
      if (!(activity?.source || '').startsWith('member')) continue
      const createdAt = new Date(activity.createdAt).getTime()
      if (Number.isNaN(createdAt)) continue
      if (createdAt >= dayStart) daySet.add(activity.memberId)
      if (createdAt >= weekStart) weekSet.add(activity.memberId)
      if (createdAt >= monthStart) monthSet.add(activity.memberId)
    }

    return {
      totalMembers: members.length,
      day: daySet.size,
      week: weekSet.size,
      month: monthSet.size,
    }
  }, [activities, members])

  const reservedPartsCount = useMemo(
    () => khatmaParts.filter((item) => Boolean(item.reservedByMemberId)).length,
    [khatmaParts],
  )
  const isKhatmaComplete = reservedPartsCount === QURAN_TOTAL_PARTS

  const buildTopThreeByMetric = (period, metricKey) => {
    const metricField = activityMetricMap[metricKey]
    if (!metricField) return []
    const start = getPeriodStart(period).getTime()
    const bucket = new Map()
    for (const activity of activities) {
      const createdAt = new Date(activity.createdAt).getTime()
      if (Number.isNaN(createdAt) || createdAt < start) continue
      const existing = bucket.get(activity.memberId) || { memberId: activity.memberId, value: 0 }
      existing.value += activity[metricField] ?? 0
      bucket.set(activity.memberId, existing)
    }

    return Array.from(bucket.values())
      .filter((item) => item.value > 0)
      .map((item) => {
        const member = members.find((m) => m.id === item.memberId)
        return {
          ...item,
          fullName: member?.fullName || 'عضو محذوف',
        }
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
  }

  const topBoards = useMemo(() => {
    return {
      day: {
        istighfar: buildTopThreeByMetric('day', 'istighfar'),
        salawat: buildTopThreeByMetric('day', 'salawat'),
        quranParts: buildTopThreeByMetric('day', 'quranParts'),
      },
      week: {
        istighfar: buildTopThreeByMetric('week', 'istighfar'),
        salawat: buildTopThreeByMetric('week', 'salawat'),
        quranParts: buildTopThreeByMetric('week', 'quranParts'),
      },
      month: {
        istighfar: buildTopThreeByMetric('month', 'istighfar'),
        salawat: buildTopThreeByMetric('month', 'salawat'),
        quranParts: buildTopThreeByMetric('month', 'quranParts'),
      },
    }
  }, [activities, members])

  const renderTopMetricList = (title, items, keyPrefix) => (
    <div className="period-metric-block">
      <h4>{title}</h4>
      {items.length ? (
        <div className="period-ranked-list">
          {items.map((item, index) => (
            <div key={`${keyPrefix}-${item.memberId}`} className="period-ranked-item">
              <span className="period-rank-badge">{index + 1}</span>
              <span className="period-rank-name">{item.fullName}</span>
              <span className="period-rank-value">{item.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="period-empty">لا يوجد نشاط.</p>
      )}
    </div>
  )

  const getMemberBanInfo = (memberId) => {
    const item = memberSecurity[memberId]
    if (!item?.banUntil) {
      return { isBanned: false, label: 'غير محظور', remainingText: '' }
    }
    const banUntilMs = new Date(item.banUntil).getTime()
    if (Number.isNaN(banUntilMs) || banUntilMs <= liveNow) {
      return { isBanned: false, label: 'غير محظور', remainingText: '' }
    }
    const isFrozen = (item?.violationLevel ?? 0) >= 99
    return {
      isBanned: true,
      label: isFrozen ? 'مجمّد' : 'محظور',
      remainingText: formatRemainingTime(banUntilMs - liveNow),
    }
  }

  const openSiteNotice = (message) => {
    setSiteNotice({ isOpen: true, message })
  }

  const closeSiteNotice = () => {
    setSiteNotice({ isOpen: false, message: '' })
  }

  const siteNoticeModal = siteNotice.isOpen ? (
    <div className="site-notice-overlay" role="dialog" aria-modal="true">
      <div className="site-notice-card">
        <h3>تنبيه</h3>
        <p>{siteNotice.message}</p>
        <button type="button" className="btn btn-primary" onClick={closeSiteNotice}>
          موافق
        </button>
      </div>
    </div>
  ) : null

  const loadMembersFromDb = async () => {
    if (!supabase) return
    const primaryQuery = supabase
      .from('members')
      .select(
        'id, full_name, phone, country, governorate, password, istighfar, salawat, quran_parts',
      )
      .order('created_at', { ascending: true })
    let { data, error } = await primaryQuery

    if (error && error.code === '42703') {
      const fallbackQuery = supabase
        .from('members')
        .select('id, full_name, phone, password, istighfar, salawat, quran_parts')
        .order('created_at', { ascending: true })
      const fallbackResult = await fallbackQuery
      data = fallbackResult.data
      error = fallbackResult.error
    }

    if (error) {
      setAuthError('تعذر جلب بيانات الأعضاء من قاعدة البيانات.')
      return
    }
    setMembers((data ?? []).map(mapMemberRow))
  }
  const loadActivitiesFromDb = async () => {
    if (!supabase) return
    const monthStartIso = getPeriodStart('month').toISOString()
    const { data, error } = await supabase
      .from('member_activity')
      .select('id, member_id, delta_istighfar, delta_salawat, delta_quran_parts, source, created_at')
      .gte('created_at', monthStartIso)
      .order('created_at', { ascending: false })
    if (error) return
    setActivities((data ?? []).map(mapActivityRow))
  }
  const loadMemberSecurityFromDb = async () => {
    if (!supabase) return
    const { data, error } = await supabase
      .from('member_security')
      .select('member_id, violation_level, ban_until')

    if (error) {
      if (error.code === '42P01') {
        setMemberSecurity({})
      }
      return
    }

    const nextSecurity = {}
    for (const row of data ?? []) {
      nextSecurity[row.member_id] = {
        violationLevel: row.violation_level ?? 0,
        banUntil: row.ban_until,
      }
    }
    setMemberSecurity(nextSecurity)
  }

  const loadKhatmaDataFromDb = async () => {
    if (!supabase) return

    const { data: partsData, error: partsError } = await supabase
      .from('group_khatma_parts')
      .select('part_number, reserved_by_member_id, reserved_by_name, reserved_at')
      .order('part_number', { ascending: true })

    if (!partsError) {
      setKhatmaParts(
        (partsData ?? []).map((row) => ({
          partNumber: row.part_number,
          reservedByMemberId: row.reserved_by_member_id,
          reservedByName: row.reserved_by_name,
          reservedAt: row.reserved_at,
        })),
      )
    }

    const { data: statsData, error: statsError } = await supabase
      .from('group_khatma_stats')
      .select('id, khatma_count, total_parts_read, total_surahs_read, total_ayat_read')
      .eq('id', 1)
      .maybeSingle()

    if (!statsError && statsData) {
      setKhatmaStats({
        khatmaCount: statsData.khatma_count ?? 0,
        totalPartsRead: statsData.total_parts_read ?? 0,
        totalSurahsRead: statsData.total_surahs_read ?? 0,
        totalAyatRead: statsData.total_ayat_read ?? 0,
      })
    }
  }

  const getReservedPartsCountFromDb = async () => {
    if (!supabase) return reservedPartsCount
    const { count, error } = await supabase
      .from('group_khatma_parts')
      .select('*', { count: 'exact', head: true })
      .not('reserved_by_member_id', 'is', null)
    if (error) return null
    return count ?? 0
  }

  const recordActivity = async ({
    memberId,
    deltaIstighfar = 0,
    deltaSalawat = 0,
    deltaQuranParts = 0,
    source = 'member',
  }) => {
    if (!supabase || !memberId) return
    if (deltaIstighfar === 0 && deltaSalawat === 0 && deltaQuranParts === 0) return
    const { data, error } = await supabase
      .from('member_activity')
      .insert({
        member_id: memberId,
        delta_istighfar: deltaIstighfar,
        delta_salawat: deltaSalawat,
        delta_quran_parts: deltaQuranParts,
        source,
      })
      .select(
        'id, member_id, delta_istighfar, delta_salawat, delta_quran_parts, source, created_at',
      )
      .maybeSingle()
    if (!error && data) {
      setActivities((prev) => [mapActivityRow(data), ...prev])
    }
  }

  useEffect(() => {
    const bootstrap = async () => {
      if (isSupabaseConfigured && supabase) {
        await loadMembersFromDb()
        await loadActivitiesFromDb()
        await loadMemberSecurityFromDb()
        await loadKhatmaDataFromDb()
      }
      setIsBooting(false)
    }
    bootstrap()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setLiveNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return

    const refreshTimers = {
      members: null,
      activities: null,
      security: null,
      khatma: null,
    }
    const scheduleRefresh = (target) => {
      if (refreshTimers[target]) return
      refreshTimers[target] = setTimeout(async () => {
        refreshTimers[target] = null
        if (target === 'members') {
          await loadMembersFromDb()
        } else if (target === 'activities') {
          await loadActivitiesFromDb()
        } else if (target === 'security') {
          await loadMemberSecurityFromDb()
        } else if (target === 'khatma') {
          await loadKhatmaDataFromDb()
        }
      }, 250)
    }

    const membersChannel = supabase
      .channel('members-live-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'members' },
        () => scheduleRefresh('members'),
      )
      .subscribe()

    const activityChannel = supabase
      .channel('member-activity-live-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'member_activity' },
        () => scheduleRefresh('activities'),
      )
      .subscribe()
    const securityChannel = supabase
      .channel('member-security-live-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'member_security' },
        () => scheduleRefresh('security'),
      )
      .subscribe()
    const khatmaPartsChannel = supabase
      .channel('group-khatma-parts-live-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_khatma_parts' },
        () => scheduleRefresh('khatma'),
      )
      .subscribe()
    const khatmaStatsChannel = supabase
      .channel('group-khatma-stats-live-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_khatma_stats' },
        () => scheduleRefresh('khatma'),
      )
      .subscribe()

    return () => {
      Object.values(refreshTimers).forEach((timer) => {
        if (timer) clearTimeout(timer)
      })
      supabase.removeChannel(membersChannel)
      supabase.removeChannel(activityChannel)
      supabase.removeChannel(securityChannel)
      supabase.removeChannel(khatmaPartsChannel)
      supabase.removeChannel(khatmaStatsChannel)
    }
  }, [])

  const getRank = (sortedList) => {
    if (!currentMember) return '-'
    const index = sortedList.findIndex((member) => member.id === currentMember.id)
    return index === -1 ? '-' : index + 1
  }

  const updateRegisterForm = (event) => {
    const { name, value } = event.target
    setRegisterForm((prev) => ({ ...prev, [name]: value }))
  }

  const updateLoginForm = (event) => {
    const { name, value } = event.target
    setLoginForm((prev) => ({ ...prev, [name]: value }))
  }

  const openCompetition = async (metric) => {
    setCompetitionMessage('')
    setActiveCompetition(metric)

    if (!supabase || !currentMember) return
    const { data, error } = await supabase
      .from('member_security')
      .select('ban_until')
      .eq('member_id', currentMember.id)
      .maybeSingle()

    if (error) return
    const banUntilMs = data?.ban_until ? new Date(data.ban_until).getTime() : 0
    if (banUntilMs > Date.now()) {
      setTapGuardState((prev) => ({
        ...prev,
        istighfar: { ...prev.istighfar, lockUntil: banUntilMs },
        salawat: { ...prev.salawat, lockUntil: banUntilMs },
      }))
      setCompetitionMessage('الحساب محظور مؤقتًا بسبب الضغط السريع.')
    }
  }

  const closeCompetition = async () => {
    if (
      (activeCompetition === 'istighfar' || activeCompetition === 'salawat') &&
      (pendingCounts[activeCompetition] ?? 0) > 0
    ) {
      openSiteNotice('سيتم إضافة التسبيح الحالي تلقائيًا قبل الرجوع للمنصة.')
      await submitCompetitionCount(activeCompetition, { bypassCooldown: true, silent: true })
    }
    setCompetitionMessage('')
    setActiveCompetition(null)
  }

  const reserveKhatmaPart = async (partNumber) => {
    if (!supabase || !currentMember) return
    setCompetitionMessage('')
    const notifyUser = (message) => {
      setCompetitionMessage(message)
      openSiteNotice(message)
    }

    const target = khatmaParts.find((item) => item.partNumber === partNumber)
    if (!target) return
    if (target.reservedByMemberId) {
      notifyUser('هذا الجزء محجوز بالفعل.')
      return
    }

    const myReservedCount = khatmaParts.filter(
      (item) => item.reservedByMemberId === currentMember.id,
    ).length
    if (myReservedCount >= MAX_PARTS_PER_MEMBER_PER_KHATMA) {
      notifyUser('الحد الأقصى لحجزك في الختمة الواحدة هو 5 أجزاء فقط.')
      return
    }

    const { data, error } = await supabase.rpc('reserve_khatma_part', {
      p_member_id: currentMember.id,
      p_member_name: currentMember.fullName,
      p_part_number: partNumber,
    })

    if (error) {
      notifyUser(`تعذر الحجز: ${error.message}`)
      return
    }

    const result = Array.isArray(data) ? data[0] : data
    if (!result?.success) {
      notifyUser(result?.message || 'تعذر الحجز.')
      await loadKhatmaDataFromDb()
      return
    }

    const { error: memberUpdateError } = await supabase
      .from('members')
      .update({ quran_parts: (currentMember.stats.quranParts ?? 0) + 1 })
      .eq('id', currentMember.id)

    if (memberUpdateError) {
      setCompetitionMessage(`تم الحجز لكن تعذر تحديث إحصائيتك: ${memberUpdateError.message}`)
    } else {
      await recordActivity({
        memberId: currentMember.id,
        deltaIstighfar: 0,
        deltaSalawat: 0,
        deltaQuranParts: 1,
        source: 'member_khatma_reservation',
      })
      setMembers((prev) =>
        prev.map((member) =>
          member.id === currentMember.id
            ? {
                ...member,
                stats: {
                  ...member.stats,
                  quranParts: (member.stats.quranParts ?? 0) + 1,
                },
              }
            : member,
        ),
      )
    }

    await loadKhatmaDataFromDb()
    const latestReservedCount = await getReservedPartsCountFromDb()
    if (latestReservedCount === QURAN_TOTAL_PARTS) {
      const { error: autoCompleteError } = await supabase.rpc('complete_group_khatma')
      if (!autoCompleteError) {
        await loadKhatmaDataFromDb()
        await loadMembersFromDb()
        await loadActivitiesFromDb()
        notifyUser('اكتمل حجز 30/30 وتم فتح ختمة جديدة تلقائيًا.')
        return
      }
    }

    notifyUser(
      result?.message ||
        'تم حجز هذا الجزء لك بنجاح. نرجو الالتزام بقراءته وإتمامه؛ فهو أمانة في ذمتك.',
    )
  }

  const cancelKhatmaPartReservation = async (partNumber) => {
    if (!supabase || !currentMember) return
    setCompetitionMessage('')
    const notifyUser = (message) => {
      setCompetitionMessage(message)
      openSiteNotice(message)
    }

    const target = khatmaParts.find((item) => item.partNumber === partNumber)
    if (!target?.reservedByMemberId) {
      notifyUser('هذا الجزء غير محجوز.')
      return
    }
    if (target.reservedByMemberId !== currentMember.id) {
      notifyUser('لا يمكنك إلغاء حجز جزء يعود لعضو آخر.')
      return
    }

    const { error: releaseError } = await supabase
      .from('group_khatma_parts')
      .update({
        reserved_by_member_id: null,
        reserved_by_name: null,
        reserved_at: null,
      })
      .eq('part_number', partNumber)
      .eq('reserved_by_member_id', currentMember.id)

    if (releaseError) {
      notifyUser(`تعذر إلغاء الحجز: ${releaseError.message}`)
      return
    }

    const nextQuranParts = Math.max(0, (currentMember.stats.quranParts ?? 0) - 1)
    const { error: memberUpdateError } = await supabase
      .from('members')
      .update({ quran_parts: nextQuranParts })
      .eq('id', currentMember.id)

    if (!memberUpdateError) {
      await recordActivity({
        memberId: currentMember.id,
        deltaIstighfar: 0,
        deltaSalawat: 0,
        deltaQuranParts: -1,
        source: 'member_khatma_cancel',
      })
      setMembers((prev) =>
        prev.map((member) =>
          member.id === currentMember.id
            ? {
                ...member,
                stats: {
                  ...member.stats,
                  quranParts: nextQuranParts,
                },
              }
            : member,
        ),
      )
    }

    await loadKhatmaDataFromDb()
    notifyUser('تم إلغاء حجز الجزء بنجاح.')
  }

  const completeGroupKhatma = async () => {
    if (!supabase) return
    setAuthError('')
    const latestReservedCount = await getReservedPartsCountFromDb()
    const effectiveReservedCount = latestReservedCount ?? reservedPartsCount
    if (latestReservedCount !== null && latestReservedCount !== reservedPartsCount) {
      await loadKhatmaDataFromDb()
    }

    if (effectiveReservedCount !== QURAN_TOTAL_PARTS) {
      setAuthError(
        `لا يمكن إنهاء الختمة قبل حجز جميع الأجزاء (المتبقي ${
          QURAN_TOTAL_PARTS - effectiveReservedCount
        }).`,
      )
      return
    }

    const { error: statsError } = await supabase.rpc('complete_group_khatma')
    if (statsError) {
      setAuthError(`تعذر إنهاء الختمة: ${statsError.message}`)
      return
    }

    await loadKhatmaDataFromDb()
    await loadMembersFromDb()
    await loadActivitiesFromDb()
    openSiteNotice('تم إنهاء الختمة وفتح ختمة جديدة بنجاح.')
  }

  const handleCompetitionTap = async (metric) => {
    if (!supabase || !currentMember) return
    const now = Date.now()
    const guard = tapGuardState[metric]
    if (!guard) return
    const tapThresholdMs = competitionConfig[metric]?.tapThresholdMs ?? 250

    if (now < guard.lockUntil) {
      setCompetitionMessage(
        `الحساب محظور مؤقتًا. المتبقي ${formatRemainingTime(guard.lockUntil - now)}.`,
      )
      return
    }

    if (guard.lastTapAt && now - guard.lastTapAt < tapThresholdMs) {
      const levelFromState = guard.violationLevel || 0
      const nextLevel = levelFromState >= 1 ? 2 : 1
      const banUntilMs = nextLevel === 2 ? Date.now() + ONE_HOUR_MS : 0

      if (nextLevel === 1) {
        // Keep popup synchronous with the tap event so mobile browsers/webviews show it reliably.
        openSiteNotice('تنبيه: الضغط سريع جدًا. عند تكرارها سيتم حظر الحساب لمدة ساعة.')
        setCompetitionMessage('تنبيه: الضغط سريع جدًا. عند تكرارها سيتم حظر الحساب لمدة ساعة.')
      }

      const { error: updateSecurityError } = await supabase.from('member_security').upsert(
        {
          member_id: currentMember.id,
          violation_level: nextLevel,
          ban_until: nextLevel === 2 ? new Date(banUntilMs).toISOString() : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'member_id' },
      )
      if (updateSecurityError) {
        setCompetitionMessage(`تعذر تحديث الحماية: ${updateSecurityError.message}`)
      }

      setTapGuardState((prev) => ({
        ...prev,
        [metric]: {
          ...prev[metric],
          lockUntil: banUntilMs,
          violationLevel: nextLevel,
          lastTapAt: now,
        },
      }))

      if (nextLevel !== 1) {
        setCompetitionMessage(
          `تم الحظر لمدة ساعة بسبب تكرار الضغط السريع. المتبقي ${formatRemainingTime(
            banUntilMs - Date.now(),
          )}.`,
        )
        openSiteNotice('تم حظر الحساب لمدة ساعة بسبب تكرار الضغط السريع.')
      }
      return
    }
    setCompetitionMessage('')
    setPendingCounts((prev) => ({
      ...prev,
      [metric]: Math.min((prev[metric] ?? 0) + 1, 5000),
    }))

    setTapGuardState((prev) => ({
      ...prev,
      [metric]: {
        ...prev[metric],
        lastTapAt: now,
        windowStartedAt: now,
        burstCount: 1,
      },
    }))
  }

  const submitCompetitionCount = async (metric, options = {}) => {
    const { bypassCooldown = false, silent = false } = options
    if (!currentMember || !supabase) return
    const pending = pendingCounts[metric] ?? 0
    if (!pending) {
      if (!silent) setCompetitionMessage('لا يوجد عدد جديد لرفعه.')
      return false
    }

    const now = Date.now()
    const guard = tapGuardState[metric]
    if (!bypassCooldown && guard && now - guard.lastSubmitAt < 6000) {
      if (!silent) setCompetitionMessage('انتظر قليلًا قبل عملية الرفع التالية.')
      return false
    }

    const activePassword =
      sessionPassword ||
      sessionStorage.getItem(SESSION_PASSWORD_KEY) ||
      localStorage.getItem(PERSISTED_PASSWORD_KEY) ||
      ''
    if (activePassword && activePassword !== sessionPassword) {
      setSessionPassword(activePassword)
      sessionStorage.setItem(SESSION_PASSWORD_KEY, activePassword)
    }
    if (!activePassword) {
      if (!silent) setCompetitionMessage('تعذر التحقق من الجلسة مؤقتًا. حاول مرة أخرى.')
      return false
    }

    let { error } = await supabase.rpc('submit_competition_count', {
      p_member_id: currentMember.id,
      p_password: activePassword,
      p_metric: metric,
      p_increment: pending,
    })

    // Backward compatibility: allow old SQL signature until DB migration is applied.
    const rpcErrorMessage = error?.message || ''
    const shouldUseLegacyPhoneRpc =
      /function\s+public\.submit_competition_count\(uuid, text, text, integer\)\s+does not exist/i.test(
        rpcErrorMessage,
      ) ||
      (rpcErrorMessage.includes('Could not find the function public.submit_competition_count') &&
        rpcErrorMessage.includes('p_member_id')) ||
      rpcErrorMessage.includes('schema cache')

    if (error && shouldUseLegacyPhoneRpc) {
      const fallback = await supabase.rpc('submit_competition_count', {
        p_phone: currentMember.phone,
        p_password: activePassword,
        p_metric: metric,
        p_increment: pending,
      })
      error = fallback.error
    }

    let submittedByChunking = false
    let submittedByRpcChunks = 0
    if (error && (error.message || '').includes('invalid increment')) {
      // Old DB versions can reject big increments; send in safe chunks.
      const LEGACY_INCREMENT_LIMIT = 300
      let remaining = pending
      let chunkError = null
      while (remaining > 0) {
        const chunk = Math.min(LEGACY_INCREMENT_LIMIT, remaining)
        const chunkResult = await supabase.rpc('submit_competition_count', {
          p_phone: currentMember.phone,
          p_password: activePassword,
          p_metric: metric,
          p_increment: chunk,
        })
        if (chunkResult.error) {
          chunkError = chunkResult.error
          break
        }
        remaining -= chunk
        submittedByRpcChunks += chunk
      }

      if (!chunkError) {
        error = null
        submittedByChunking = true
      } else {
        error = chunkError
      }
    }

    if (error) {
      const errorMessage = error.message || ''

      if (errorMessage.includes('rate limit exceeded') && submittedByRpcChunks > 0) {
        const remainingAfterChunks = Math.max(0, pending - submittedByRpcChunks)
        setPendingCounts((prev) => ({ ...prev, [metric]: remainingAfterChunks }))
        setTapGuardState((prev) => ({
          ...prev,
          [metric]: {
            ...prev[metric],
            lastSubmitAt: now,
          },
        }))
        await loadMembersFromDb()
        await loadActivitiesFromDb()
        if (!silent) {
          setCompetitionMessage(
            `تم رفع ${formatArabicNumber(
              submittedByRpcChunks,
            )} تلقائيًا. المتبقي ${formatArabicNumber(remainingAfterChunks)} وسيُرفع عند المحاولة التالية.`,
          )
        }
        return true
      }

      if (
        errorMessage.includes('function digest(text, unknown) does not exist') ||
        (errorMessage.includes('rate limit exceeded') && submittedByRpcChunks === 0)
      ) {
        // Fallback direct update until SQL function search_path is fixed.
        const dbField = metricDbFieldMap[metric]
        const currentValue = currentMember.stats[metric] ?? 0
        const nextValue = currentValue + pending
        const { error: updateError } = await supabase
          .from('members')
          .update({ [dbField]: nextValue })
          .eq('id', currentMember.id)
        if (updateError) {
          if (!silent) setCompetitionMessage(`تعذر الرفع: ${updateError.message}`)
          return false
        }
        await recordActivity({
          memberId: currentMember.id,
          deltaIstighfar: metric === 'istighfar' ? pending : 0,
          deltaSalawat: metric === 'salawat' ? pending : 0,
          deltaQuranParts: 0,
          source: 'member_competition',
        })
        setPendingCounts((prev) => ({ ...prev, [metric]: 0 }))
        setTapGuardState((prev) => ({
          ...prev,
          [metric]: {
            ...prev[metric],
            lastSubmitAt: now,
          },
        }))
        await loadMembersFromDb()
        await loadActivitiesFromDb()
        if (!silent) setCompetitionMessage('تم الرفع بنجاح (وضع مؤقت حتى تحديث SQL).')
        return true
      }
      if (errorMessage.includes('invalid password')) {
        setSessionPassword('')
        sessionStorage.removeItem(SESSION_PASSWORD_KEY)
        localStorage.removeItem(PERSISTED_PASSWORD_KEY)
        if (!silent) setCompetitionMessage('كلمة المرور غير صحيحة. أعد المحاولة.')
        return false
      }
      const match = /banned until (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/i.exec(errorMessage)
      if (match) {
        const untilMs = Date.parse(match[1].replace(' ', 'T') + ':00Z')
        if (!Number.isNaN(untilMs)) {
          setTapGuardState((prev) => ({
            ...prev,
            [metric]: {
              ...prev[metric],
              lockUntil: untilMs,
            },
          }))
          setCompetitionMessage(
            `الحساب محظور حاليًا. المتبقي ${formatRemainingTime(untilMs - Date.now())}.`,
          )
          return false
        }
      }
      if (!silent) setCompetitionMessage(`تعذر الرفع: ${errorMessage}`)
      return false
    }
    setPendingCounts((prev) => ({ ...prev, [metric]: 0 }))
    setTapGuardState((prev) => ({
      ...prev,
      [metric]: {
        ...prev[metric],
        lastSubmitAt: now,
      },
    }))
    await loadMembersFromDb()
    await loadActivitiesFromDb()
    if (!silent) {
      setCompetitionMessage(
        submittedByChunking ? 'تم الرفع بنجاح (على دفعات متتالية).' : 'تم الرفع بنجاح.',
      )
    }
    return true
  }

  const registerUser = async (event) => {
    event.preventDefault()
    setAuthError('')
    setAuthSuccess('')

    const fullName = registerForm.fullName.trim().replace(/\s+/g, ' ')
    const country = registerForm.country.trim() || 'العراق'
    const governorate = registerForm.governorate.trim()
    const password = registerForm.password.trim()

    if (!fullName) {
      setAuthError('الرجاء إدخال الاسم.')
      return
    }
    if (isNameTaken(members, fullName)) {
      setAuthError('الاسم موجود بالفعل اختر اسما اخر')
      return
    }
    if (country === 'العراق' && !governorate) {
      setAuthError('الرجاء اختيار المحافظة داخل العراق.')
      return
    }
    if (password.length < 6) {
      setAuthError('كلمة السر يجب أن تكون 6 أحرف أو أكثر.')
      return
    }
    if (!supabase) {
      setAuthError('يرجى ضبط مفاتيح Supabase أولًا.')
      return
    }

    setIsSubmitting(true)
    const passwordHash = await hashPassword(password)
    const legacyPhone = buildLegacyPhoneFromName(fullName)
    let { error } = await supabase.from('members').insert({
      full_name: fullName,
      phone: legacyPhone,
      country,
      governorate,
      password: passwordHash,
      istighfar: 0,
      salawat: 0,
      quran_parts: 0,
    })

    if (error && error.code === '42703') {
      const fallbackInsert = await supabase.from('members').insert({
        full_name: fullName,
        phone: legacyPhone,
        password: passwordHash,
        istighfar: 0,
        salawat: 0,
        quran_parts: 0,
      })
      error = fallbackInsert.error
    }

    if (error) {
      if (error.code === '23505') {
        setAuthError('الاسم موجود بالفعل اختر اسما اخر')
      } else {
        setAuthError('تعذر إنشاء الحساب. حاول مرة أخرى.')
      }
      setIsSubmitting(false)
      return
    }

    localStorage.setItem(CURRENT_MEMBER_NAME_KEY, normalizeDisplayName(fullName))
    localStorage.removeItem(LEGACY_MEMBER_PHONE_KEY)
    localStorage.removeItem(ADMIN_SESSION_KEY)
    setIsAdminSession(false)
    setSessionPassword(password)
    sessionStorage.setItem(SESSION_PASSWORD_KEY, password)
    localStorage.setItem(PERSISTED_PASSWORD_KEY, password)
    setTapGuardState(createInitialTapGuardState())
    setSessionPhone(normalizeDisplayName(fullName))
    setRegisterForm(initialRegisterForm)
    setAuthSuccess('تم إنشاء الحساب وتسجيل الدخول بنجاح.')
    await loadMembersFromDb()
    setIsSubmitting(false)
  }

  const handleLogin = async (event) => {
    event.preventDefault()
    setAuthError('')
    setAuthSuccess('')

    const fullName = loginForm.fullName.trim().replace(/\s+/g, ' ')
    const normalizedName = normalizeDisplayName(fullName)
    const password = loginForm.password.trim()
    const configuredSecret = adminPasswordHash || adminPassword
    if (!normalizedName) {
      setAuthError('الاسم غير صحيح.')
      return
    }
    if (adminIdentity && configuredSecret) {
      const isAdminPasswordCorrect = await compareWithConfiguredSecret(password, configuredSecret)
      if (normalizedName === adminIdentity && isAdminPasswordCorrect) {
        localStorage.setItem(ADMIN_SESSION_KEY, '1')
        localStorage.removeItem(CURRENT_MEMBER_NAME_KEY)
        localStorage.removeItem(LEGACY_MEMBER_PHONE_KEY)
        sessionStorage.removeItem(SESSION_PASSWORD_KEY)
        localStorage.removeItem(PERSISTED_PASSWORD_KEY)
        setSessionPhone('')
        setSessionPassword('')
        setIsAdminSession(true)
        setLoginForm(initialLoginForm)
        return
      }
    }

    if (!supabase) {
      setAuthError('يرجى ضبط مفاتيح Supabase أولًا.')
      return
    }

    setIsSubmitting(true)
    let { data, error } = await supabase
      .from('members')
      .select('id, full_name, phone, country, governorate, password, istighfar, salawat, quran_parts')
      .ilike('full_name', fullName)
      .limit(1)
      .maybeSingle()

    if (error && error.code === '42703') {
      const fallback = await supabase
        .from('members')
        .select('id, full_name, phone, password, istighfar, salawat, quran_parts')
        .ilike('full_name', fullName)
        .limit(1)
        .maybeSingle()
      data = fallback.data
      error = fallback.error
    }

    if (error || !data) {
      setAuthError('الاسم أو كلمة المرور غير صحيحة.')
      setIsSubmitting(false)
      return
    }

    const isValidPassword = await verifyPassword(password, data.password)
    if (!isValidPassword) {
      setAuthError('الاسم أو كلمة المرور غير صحيحة.')
      setIsSubmitting(false)
      return
    }

    if (!isHashedPassword(data.password)) {
      const upgradedPasswordHash = await hashPassword(password)
      await supabase
        .from('members')
        .update({ password: upgradedPasswordHash })
        .eq('id', data.id)
    }

    localStorage.setItem(CURRENT_MEMBER_NAME_KEY, normalizedName)
    localStorage.removeItem(LEGACY_MEMBER_PHONE_KEY)
    localStorage.removeItem(ADMIN_SESSION_KEY)
    setIsAdminSession(false)
    setSessionPassword(password)
    sessionStorage.setItem(SESSION_PASSWORD_KEY, password)
    localStorage.setItem(PERSISTED_PASSWORD_KEY, password)
    setTapGuardState(createInitialTapGuardState())
    setSessionPhone(normalizedName)
    setLoginForm(initialLoginForm)
    await loadMembersFromDb()
    setIsSubmitting(false)
  }

  const handleStatsChange = async (event) => {
    if (!currentMember || !supabase) return

    const { name, value } = event.target
    const safeNumber = Math.max(0, Number(value) || 0)
    const previousValue = currentMember.stats[name] ?? 0
    const deltaValue = safeNumber - previousValue
    const dbField = metricDbFieldMap[name]
    if (!dbField) return

    const nextMembers = members.map((member) =>
      member.id === currentMember.id
        ? { ...member, stats: { ...member.stats, [name]: safeNumber } }
        : member,
    )
    setMembers(nextMembers)

    const { error } = await supabase
      .from('members')
      .update({ [dbField]: safeNumber })
      .eq('id', currentMember.id)

    if (error) {
      setAuthError('تعذر حفظ الإحصائية في قاعدة البيانات.')
      await loadMembersFromDb()
      return
    }
    await recordActivity({
      memberId: currentMember.id,
      deltaIstighfar: name === 'istighfar' ? deltaValue : 0,
      deltaSalawat: name === 'salawat' ? deltaValue : 0,
      deltaQuranParts: name === 'quranParts' ? deltaValue : 0,
      source: 'member',
    })
  }

  const updateAdminDraft = (memberId, field, value) => {
    const safeValue =
      field === 'fullName' ? value : Math.max(0, Number(value) || 0)
    setAdminDrafts((prev) => ({
      ...prev,
      [memberId]: {
        ...prev[memberId],
        [field]: safeValue,
      },
    }))
  }

  const saveAdminStats = async (member) => {
    if (!supabase) return

    const draft = adminDrafts[member.id] || {}
    const nextStats = {
      istighfar: draft.istighfar ?? member.stats.istighfar,
      salawat: draft.salawat ?? member.stats.salawat,
      quranParts: draft.quranParts ?? member.stats.quranParts,
    }
    const nextFullName = (draft.fullName ?? member.fullName).trim().replace(/\s+/g, ' ')
    if (!nextFullName) {
      setAuthError('الرجاء إدخال الاسم.')
      return
    }
    if (isNameTaken(members, nextFullName, member.id)) {
      setAuthError('الاسم موجود بالفعل اختر اسما اخر')
      return
    }

    const { error } = await supabase
      .from('members')
      .update({
        full_name: nextFullName,
        istighfar: nextStats.istighfar,
        salawat: nextStats.salawat,
        quran_parts: nextStats.quranParts,
      })
      .eq('id', member.id)

    if (error) {
      if (error.code === '23505' && (error.message || '').includes('members_full_name')) {
        setAuthError('الاسم موجود بالفعل اختر اسما اخر')
      } else {
        setAuthError('تعذر حفظ تعديلات المشرف.')
      }
      return
    }
    await recordActivity({
      memberId: member.id,
      deltaIstighfar: nextStats.istighfar - member.stats.istighfar,
      deltaSalawat: nextStats.salawat - member.stats.salawat,
      deltaQuranParts: nextStats.quranParts - member.stats.quranParts,
      source: 'admin',
    })

    setMembers((prev) =>
      prev.map((item) =>
        item.id === member.id ? { ...item, fullName: nextFullName, stats: { ...nextStats } } : item,
      ),
    )
    setAdminDrafts((prev) => {
      const copy = { ...prev }
      delete copy[member.id]
      return copy
    })
  }

  const resetMemberStats = async (member) => {
    if (!supabase) return
    const { error } = await supabase
      .from('members')
      .update({ istighfar: 0, salawat: 0, quran_parts: 0 })
      .eq('id', member.id)
    if (error) {
      setAuthError('تعذر تصفير إحصائيات العضو.')
      return
    }
    await recordActivity({
      memberId: member.id,
      deltaIstighfar: -member.stats.istighfar,
      deltaSalawat: -member.stats.salawat,
      deltaQuranParts: -member.stats.quranParts,
      source: 'admin',
    })
    setMembers((prev) =>
      prev.map((item) =>
        item.id === member.id
          ? { ...item, stats: { istighfar: 0, salawat: 0, quranParts: 0 } }
          : item,
      ),
    )
    setAdminDrafts((prev) => {
      const copy = { ...prev }
      delete copy[member.id]
      return copy
    })
  }

  const liftMemberBan = async (member) => {
    if (!supabase) return
    setAuthError('')

    const { error } = await supabase
      .from('member_security')
      .upsert(
        {
          member_id: member.id,
          violation_level: 0,
          ban_until: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'member_id' },
      )

    if (error) {
      if (error.code === '42P01') {
        setAuthError('جدول الحماية غير موجود. نفّذ ملف supabase-setup.sql مرة أخرى.')
      } else {
        setAuthError(`تعذر رفع الحظر: ${error.message}`)
      }
      return
    }

    setMemberSecurity((prev) => ({
      ...prev,
      [member.id]: {
        violationLevel: 0,
        banUntil: null,
      },
    }))
  }

  const setMemberRestriction = async (member, type) => {
    if (!supabase) return
    setAuthError('')
    const isFreeze = type === 'freeze'
    const banUntil = isFreeze
      ? new Date('2099-12-31T23:59:59.000Z').toISOString()
      : new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
    const violationLevel = isFreeze ? 99 : 5

    const { error } = await supabase
      .from('member_security')
      .upsert(
        {
          member_id: member.id,
          violation_level: violationLevel,
          ban_until: banUntil,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'member_id' },
      )

    if (error) {
      setAuthError(`تعذر تحديث حالة الحساب: ${error.message}`)
      return
    }

    setMemberSecurity((prev) => ({
      ...prev,
      [member.id]: {
        violationLevel,
        banUntil,
      },
    }))
  }

  const cancelMemberKhatmaReservations = async (member) => {
    if (!supabase) return
    setAuthError('')
    const { data: releasedRows, error: releaseError } = await supabase
      .from('group_khatma_parts')
      .update({
        reserved_by_member_id: null,
        reserved_by_name: null,
        reserved_at: null,
      })
      .eq('reserved_by_member_id', member.id)
      .select('part_number')

    if (releaseError) {
      setAuthError(`تعذر إلغاء حجوزات الختمة: ${releaseError.message}`)
      return
    }
    const releasedCount = releasedRows?.length ?? 0
    if (!releasedCount) {
      setAuthError('لا توجد حجوزات ختمة لهذا العضو لإلغائها.')
      await loadKhatmaDataFromDb()
      return
    }

    const nextQuranParts = Math.max(0, (member.stats.quranParts ?? 0) - releasedCount)
    const { error: memberUpdateError } = await supabase
      .from('members')
      .update({ quran_parts: nextQuranParts })
      .eq('id', member.id)

    if (memberUpdateError) {
      setAuthError(`تم إلغاء الحجوزات لكن تعذر تحديث الإحصائية: ${memberUpdateError.message}`)
    } else {
      await recordActivity({
        memberId: member.id,
        deltaIstighfar: 0,
        deltaSalawat: 0,
        deltaQuranParts: -releasedCount,
        source: 'admin_khatma_cancel',
      })
      setMembers((prev) =>
        prev.map((item) =>
          item.id === member.id
            ? {
                ...item,
                stats: {
                  ...item.stats,
                  quranParts: nextQuranParts,
                },
              }
            : item,
        ),
      )
    }

    await loadKhatmaDataFromDb()
    await loadMembersFromDb()
    openSiteNotice(`تم إلغاء ${releasedCount} جزء من حجوزات الختمة لهذا العضو.`)
  }

  const adminCancelKhatmaPartReservation = async (partNumber) => {
    if (!supabase) return
    setAuthError('')

    const target = khatmaParts.find((item) => item.partNumber === partNumber)
    if (!target?.reservedByMemberId) {
      setAuthError('هذا الجزء غير محجوز حاليًا.')
      return
    }
    if (!window.confirm(`تأكيد إلغاء حجز الجزء ${partNumber}؟`)) return

    const memberId = target.reservedByMemberId
    const reservedMember = members.find((member) => member.id === memberId) || null

    const { data: releasedRow, error: releaseError } = await supabase
      .from('group_khatma_parts')
      .update({
        reserved_by_member_id: null,
        reserved_by_name: null,
        reserved_at: null,
      })
      .eq('part_number', partNumber)
      .eq('reserved_by_member_id', memberId)
      .select('part_number')
      .maybeSingle()

    if (releaseError) {
      setAuthError(`تعذر إلغاء الحجز: ${releaseError.message}`)
      return
    }
    if (!releasedRow) {
      setAuthError('تعذر إلغاء الحجز حاليًا. حاول تحديث الصفحة ثم أعد المحاولة.')
      await loadKhatmaDataFromDb()
      return
    }

    if (reservedMember) {
      const nextQuranParts = Math.max(0, (reservedMember.stats.quranParts ?? 0) - 1)
      const { error: memberUpdateError } = await supabase
        .from('members')
        .update({ quran_parts: nextQuranParts })
        .eq('id', reservedMember.id)

      if (memberUpdateError) {
        setAuthError(`تم إلغاء الحجز لكن تعذر تحديث إحصائية العضو: ${memberUpdateError.message}`)
      } else {
        await recordActivity({
          memberId: reservedMember.id,
          deltaIstighfar: 0,
          deltaSalawat: 0,
          deltaQuranParts: -1,
          source: 'admin_khatma_cancel',
        })
        setMembers((prev) =>
          prev.map((member) =>
            member.id === reservedMember.id
              ? {
                  ...member,
                  stats: {
                    ...member.stats,
                    quranParts: nextQuranParts,
                  },
                }
              : member,
          ),
        )
      }
    }

    await loadKhatmaDataFromDb()
    await loadMembersFromDb()
  }

  const deleteMemberAccount = async (member) => {
    if (!supabase) return
    setAuthError('')
    if (!window.confirm(`تأكيد حذف الحساب: ${member.fullName} ؟`)) return

    const { error: activityDeleteError } = await supabase
      .from('member_activity')
      .delete()
      .eq('member_id', member.id)

    if (activityDeleteError && activityDeleteError.code !== '42P01') {
      setAuthError(`تعذر حذف نشاطات العضو: ${activityDeleteError.message}`)
      return
    }

    const { error } = await supabase.from('members').delete().eq('id', member.id)
    if (error) {
      setAuthError(`تعذر حذف العضو: ${error.message}`)
      return
    }

    setMembers((prev) => prev.filter((item) => item.id !== member.id))
    setActivities((prev) => prev.filter((item) => item.memberId !== member.id))
    setMemberSecurity((prev) => {
      const copy = { ...prev }
      delete copy[member.id]
      return copy
    })
    setAdminDrafts((prev) => {
      const copy = { ...prev }
      delete copy[member.id]
      return copy
    })
  }

  const handleLogout = async () => {
    if (!isAutoSubmittingPending && currentMember) {
      const pendingDhikr = (pendingCounts.istighfar ?? 0) + (pendingCounts.salawat ?? 0)
      if (pendingDhikr > 0) {
        openSiteNotice('تنبيه: سيتم إضافة التسبيح الحالي تلقائيًا قبل تسجيل الخروج.')
        setIsAutoSubmittingPending(true)
        await submitCompetitionCount('istighfar', { bypassCooldown: true, silent: true })
        await submitCompetitionCount('salawat', { bypassCooldown: true, silent: true })
        setIsAutoSubmittingPending(false)
      }
    }
    localStorage.removeItem(CURRENT_MEMBER_NAME_KEY)
    localStorage.removeItem(LEGACY_MEMBER_PHONE_KEY)
    localStorage.removeItem(ADMIN_SESSION_KEY)
    localStorage.removeItem(PERSISTED_PASSWORD_KEY)
    sessionStorage.removeItem(SESSION_PASSWORD_KEY)
    setSessionPhone('')
    setIsAdminSession(false)
    setAuthMode('login')
    setActiveCompetition(null)
    setCompetitionMessage('')
    setPendingCounts({ istighfar: 0, salawat: 0, quranParts: 0 })
    setTapGuardState(createInitialTapGuardState())
    setSessionPassword('')
  }

  useEffect(() => {
    if (!currentMember) return
    const stored = readPendingStore()
    if (!stored || stored.memberId !== currentMember.id) return
    const nextIstighfar = Math.max(0, Number(stored?.counts?.istighfar) || 0)
    const nextSalawat = Math.max(0, Number(stored?.counts?.salawat) || 0)
    if (!nextIstighfar && !nextSalawat) return
    setPendingCounts((prev) => ({ ...prev, istighfar: nextIstighfar, salawat: nextSalawat }))
  }, [currentMember?.id])

  useEffect(() => {
    if (!currentMember) return
    const tracked = {
      istighfar: Math.max(0, Number(pendingCounts.istighfar) || 0),
      salawat: Math.max(0, Number(pendingCounts.salawat) || 0),
    }
    if (!tracked.istighfar && !tracked.salawat) {
      const stored = readPendingStore()
      if (stored?.memberId === currentMember.id) {
        localStorage.removeItem(PENDING_COUNTS_KEY)
      }
      return
    }
    localStorage.setItem(
      PENDING_COUNTS_KEY,
      JSON.stringify({
        memberId: currentMember.id,
        counts: tracked,
      }),
    )
  }, [pendingCounts.istighfar, pendingCounts.salawat, currentMember?.id])

  useEffect(() => {
    const pendingDhikr = (pendingCounts.istighfar ?? 0) + (pendingCounts.salawat ?? 0)
    if (!pendingDhikr || !currentMember) return undefined

    const handleBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
      localStorage.setItem(
        PENDING_COUNTS_KEY,
        JSON.stringify({
          memberId: currentMember.id,
          counts: {
            istighfar: pendingCounts.istighfar ?? 0,
            salawat: pendingCounts.salawat ?? 0,
          },
        }),
      )
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [pendingCounts.istighfar, pendingCounts.salawat, currentMember?.id])

  useEffect(() => {
    if (typeof window === 'undefined' || !('ontouchstart' in window)) return undefined

    let touchStartY = null
    let pullDistance = 0
    let lastRefreshAt = 0
    const REFRESH_THRESHOLD_PX = 95
    const REFRESH_COOLDOWN_MS = 1500

    const handleTouchStart = (event) => {
      touchStartY = event.touches?.[0]?.clientY ?? null
      pullDistance = 0
    }

    const handleTouchMove = (event) => {
      if (touchStartY === null) return
      const currentY = event.touches?.[0]?.clientY ?? touchStartY
      pullDistance = currentY - touchStartY
    }

    const handleTouchEnd = () => {
      const now = Date.now()
      const isAtTop = window.scrollY <= 0
      if (
        isAtTop &&
        pullDistance >= REFRESH_THRESHOLD_PX &&
        now - lastRefreshAt > REFRESH_COOLDOWN_MS
      ) {
        lastRefreshAt = now
        window.location.reload()
      }
      touchStartY = null
      pullDistance = 0
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [])

  if (isBooting) {
    return (
      <main className="page" dir="rtl">
        <section className="loading-shell" aria-live="polite">
          <div className="loading-card">
            <div className="loading-logo-wrap" aria-hidden="true">
              <SiteLogo size={34} />
            </div>
            <h2>جاري تحميل بيانات المنصة</h2>
            <p>يتم تحديث الإحصائيات والنتائج الآن...</p>
            <div className="loading-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        </section>
        {siteNoticeModal}
      </main>
    )
  }

  if (currentMember) {
    if (
      activeCompetition === 'istighfar' ||
      activeCompetition === 'salawat' ||
      activeCompetition === 'quranParts'
    ) {
      const cfg = competitionConfig[activeCompetition]
      const metric = activeCompetition
      const totalGlobal =
        metric === 'quranParts'
          ? khatmaStats.totalPartsRead
          : totals[metric]
      const totalSurahsProgress = khatmaStats.totalSurahsRead
      const totalAyatProgress = khatmaStats.totalAyatRead
      const memberTotal =
        metric === 'quranParts'
          ? khatmaParts.filter((item) => item.reservedByMemberId === currentMember.id).length
          : currentMember.stats[metric]
      const pending = pendingCounts[metric] ?? 0
      const motivationState =
        metric === 'quranParts' ? null : buildMotivationState(totalGlobal)
      const banRemainingMs =
        metric === 'quranParts'
          ? 0
          : Math.max(0, (tapGuardState[metric]?.lockUntil || 0) - liveNow)
      const isBanned = banRemainingMs > 0
      const tapThresholdLabel =
        (competitionConfig[metric]?.tapThresholdMs ?? 250) >= 500
          ? 'نصف ثانية'
          : 'ربع ثانية'

      return (
        <main className="page" dir="rtl">
          <header className="hero">
            <div className="hero-head-row">
              <span className="badge badge-brand">
                <SiteLogo size={20} />
                {cfg.title}
              </span>
              <button
                type="button"
                className="btn btn-outline competition-back-btn"
                onClick={closeCompetition}
              >
                الرجوع للمنصة
              </button>
            </div>
            <h1>{cfg.title}</h1>
            <p>
              {metric === 'quranParts'
                ? 'اختر جزءًا من 30 جزءًا واحجزه باسمك ضمن الختمة الجماعية.'
                : 'اضغط على المسبحة ثم ارفع العدد ليتم احتسابه في الإجمالي العام.'}
            </p>
          </header>

          <section className="section competition-center">
            {isBanned ? (
              <div className="ban-banner">
                <strong>الحساب في وضع الحظر المؤقت.</strong>
                <span>الوقت المتبقي: {formatRemainingTime(banRemainingMs)}</span>
              </div>
            ) : null}
            <div className="competition-stack">
              {metric === 'quranParts' ? (
                <>
                  <div className="quran-stats-row">
                    <article className="card">
                      <h3>عدد الختمات</h3>
                      <p className="stat-number">{khatmaStats.khatmaCount}</p>
                    </article>
                    <article className="card">
                      <h3>عدد الأجزاء المقروءة</h3>
                      <p className="stat-number">{khatmaStats.totalPartsRead}</p>
                    </article>
                    <article className="card">
                      <h3>عدد السور المقروءة</h3>
                      <p className="stat-number">{totalSurahsProgress}</p>
                    </article>
                    <article className="card">
                      <h3>عدد الآيات المقروءة</h3>
                      <p className="stat-number">{totalAyatProgress}</p>
                    </article>
                  </div>
                  <article className="card quran-personal-card">
                    <h3>الأجزاء المحجوزة باسمك</h3>
                    <p className="stat-number">{memberTotal}</p>
                  </article>
                  <article className="card">
                    <h3>عدد الأجزاء المحجوزة حاليًا</h3>
                    <p className="stat-number">{reservedPartsCount} / 30</p>
                  </article>

                  <div className="khatma-parts-grid">
                    {Array.from({ length: QURAN_TOTAL_PARTS }, (_, idx) => idx + 1).map((part) => {
                      const item = khatmaParts.find((row) => row.partNumber === part)
                      const isReserved = Boolean(item?.reservedByMemberId)
                      const reservedBy = item?.reservedByName || ''
                      return (
                        <article
                          key={part}
                          className={`khatma-part-card ${isReserved ? 'khatma-part-reserved' : ''}`}
                        >
                          <h4>الجزء {part}</h4>
                          {isReserved ? (
                            <>
                              <p>{reservedBy}</p>
                              {item?.reservedByMemberId === currentMember.id ? (
                                <button
                                  type="button"
                                  className="btn btn-cancel-outline"
                                  onClick={() => cancelKhatmaPartReservation(part)}
                                >
                                  إلغاء الحجز
                                </button>
                              ) : null}
                            </>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => reserveKhatmaPart(part)}
                            >
                              حجز
                            </button>
                          )}
                        </article>
                      )
                    })}
                  </div>
                </>
              ) : (
                <>
                  <article className="card">
                    <h3>العداد الكلي للمستخدمين</h3>
                    <p className="stat-number">{totalGlobal}</p>
                    <div className="inline-goal-box">
                      <p className="motivation-target-single-line">
                        هدفنا القادم {String(Number(motivationState?.target || 0))}
                      </p>
                      <div className="motivation-progress-track" aria-hidden="true">
                        <span
                          className="motivation-progress-fill"
                          style={{ width: `${Math.round((motivationState?.progressRatio ?? 0) * 100)}%` }}
                        />
                      </div>
                      <p className="motivation-note">
                        المتبقي {formatEnglishNumber(motivationState?.remaining)} للوصول إلى الهدف.
                      </p>
                    </div>
                  </article>
                  <article className="card">
                    <h3>العداد الكلي لك</h3>
                    <p className="stat-number">{memberTotal}</p>
                  </article>
                  <article className="card">
                    <h3>العدد الحالي</h3>
                    <p className="stat-number">{pending}</p>
                  </article>

                  <button
                    type="button"
                    className="tasbeeh-btn"
                    onClick={() => handleCompetitionTap(metric)}
                  >
                    {metric === 'istighfar' || metric === 'salawat' ? (
                      <span className="tasbeeh-calligraphy-badge">
                        <span
                          className={`tasbeeh-calligraphy-text ${
                            metric === 'salawat' ? 'tasbeeh-calligraphy-text-salawat' : ''
                          }`}
                        >
                          {cfg.buttonText}
                        </span>
                      </span>
                    ) : (
                      cfg.buttonText
                    )}
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary competition-submit"
                    onClick={() => submitCompetitionCount(metric)}
                  >
                    {cfg.submitText}
                  </button>
                </>
              )}
            </div>

            {metric !== 'quranParts' ? (
              <p className="subtle-note">يؤدي الضغط الوهمي العشوائي الى حضر الحساب و عدم احتساب التسبيح</p>
            ) : (
              <p className="subtle-note">
                ملاحظة: الحد الأقصى لكل عضو 5 أجزاء. عند اكتمال حجز 30/30 تُفتح ختمة جديدة تلقائيًا.
              </p>
            )}
            {competitionMessage ? <p className="success-text">{competitionMessage}</p> : null}
          </section>
          {siteNoticeModal}
          <footer className="footer">جميع الحقوق محفوضة الى مؤسسة زهرة المنتظر 2026</footer>
        </main>
      )
    }

    return (
      <main className="page" dir="rtl">
        <header className="hero">
          <div className="hero-head-row">
            <span className="badge badge-brand">
              <SiteLogo size={20} />
              بنك الحسنات
            </span>
            <button type="button" className="btn btn-outline competition-back-btn" onClick={handleLogout}>
              تسجيل الخروج
            </button>
          </div>
          <h1>مرحبًا {currentMember.fullName}</h1>
          <p>
            حسابك محفوظ. يمكنك العودة في أي وقت بنفس الاسم وكلمة المرور
            ومتابعة تقدمك.
          </p>
        </header>

        <section className="section">
          <h2>الدخول إلى المسابقات</h2>
          <div className="action-grid">
            <button
              type="button"
              className="btn btn-primary action-btn-large"
              onClick={() => openCompetition('istighfar')}
            >
              دخول مسابقة الاستغفار
            </button>
            <button
              type="button"
              className="btn btn-primary action-btn-large"
              onClick={() => openCompetition('salawat')}
            >
              دخول مسابقة الصلاة على النبي
            </button>
            <button
              type="button"
              className="btn btn-primary action-btn-large"
              onClick={() => openCompetition('quranParts')}
            >
              دخول مسابقة الختمات
            </button>
          </div>
        </section>

        <section className="section">
          <h2>إحصائياتي</h2>
          <div className="cards">
            <article className="card">
              <span className="card-icon card-icon-custom">
                <TasbeehIcon />
              </span>
              <h3>عدد الاستغفار</h3>
              <p className="stat-number">{currentMember.stats.istighfar}</p>
            </article>
            <article className="card">
              <span className="card-icon card-icon-custom">
                <DomeIcon />
              </span>
              <h3>عدد الصلاة على النبي</h3>
              <p className="stat-number">{currentMember.stats.salawat}</p>
            </article>
            <article className="card">
              <span className="card-icon card-icon-custom">
                <OpenBookIcon />
              </span>
              <h3>عدد أجزاء القران</h3>
              <p className="stat-number">{currentMember.stats.quranParts}</p>
            </article>
          </div>
        </section>

        <section className="section">
          <h2>لوحة الشرف (أفضل 14 عضوًا)</h2>
          <div className="honor-grid">
            <article className="leaderboard honor-card">
              <div className="leaderboard-row leaderboard-head honor-head">
                <span>الترتيب</span>
                <span>الأكثر استغفارًا</span>
                <span>العدد</span>
              </div>
              {sortedByIstighfar.slice(0, 14).map((member, index) => (
                <div key={`honor-i-${member.id}`} className="leaderboard-row honor-row">
                  <span>{index + 1}</span>
                  <span>{member.fullName}</span>
                  <span>{member.stats.istighfar}</span>
                </div>
              ))}
            </article>

            <article className="leaderboard honor-card">
              <div className="leaderboard-row leaderboard-head honor-head">
                <span>الترتيب</span>
                <span>الأكثر صلاة على النبي</span>
                <span>العدد</span>
              </div>
              {sortedBySalawat.slice(0, 14).map((member, index) => (
                <div key={`honor-s-${member.id}`} className="leaderboard-row honor-row">
                  <span>{index + 1}</span>
                  <span>{member.fullName}</span>
                  <span>{member.stats.salawat}</span>
                </div>
              ))}
            </article>

            <article className="leaderboard honor-card">
              <div className="leaderboard-row leaderboard-head honor-head">
                <span>الترتيب</span>
                <span>الأكثر ختمات (أجزاء)</span>
                <span>العدد</span>
              </div>
              {sortedByQuranParts.slice(0, 14).map((member, index) => (
                <div key={`honor-q-${member.id}`} className="leaderboard-row honor-row">
                  <span>{index + 1}</span>
                  <span>{member.fullName}</span>
                  <span>{member.stats.quranParts}</span>
                </div>
              ))}
            </article>
          </div>
          <p className="subtle-note honor-note-center">
            يتم تحديث لوحة الشرف تلقائيًا كلما تغيرت نتائج الأعضاء.
          </p>
        </section>

        {siteNoticeModal}
        <footer className="footer">جميع الحقوق محفوضة الى مؤسسة زهرة المنتظر 2026</footer>
      </main>
    )
  }

  if (isAdminSession) {
    return (
      <main className="page" dir="rtl">
        <header className="hero">
          <div className="hero-head-row">
            <span className="badge badge-brand">
              <SiteLogo size={20} />
              لوحة مشرف بنك الحسنات
            </span>
            <button type="button" className="btn btn-outline competition-back-btn" onClick={handleLogout}>
              تسجيل الخروج
            </button>
          </div>
          <h1>مرحبًا بك يا مشرف</h1>
          <p>هنا يمكنك متابعة كل الأعضاء وتعديل الإحصائيات بسهولة.</p>
          <div className="hero-highlights">
            <span>إجمالي الأعضاء: {members.length}</span>
          </div>
        </header>

        <section className="section">
          <div className="admin-activity-strip">
            <article className="card admin-activity-card">
              <h3>إجمالي الأعضاء</h3>
              <p className="stat-number">{activeMemberCounts.totalMembers}</p>
            </article>
            <article className="card admin-activity-card">
              <h3>الأعضاء النشطون اليوم</h3>
              <p className="stat-number">{activeMemberCounts.day}</p>
            </article>
            <article className="card admin-activity-card">
              <h3>الأعضاء النشطون آخر أسبوع</h3>
              <p className="stat-number">{activeMemberCounts.week}</p>
            </article>
            <article className="card admin-activity-card">
              <h3>الأعضاء النشطون آخر شهر</h3>
              <p className="stat-number">{activeMemberCounts.month}</p>
            </article>
          </div>
        </section>

        <section className="section">
          <h2>إدارة الختمة الجماعية</h2>
          <div className="cards">
            <article className="card">
              <h3>عدد الختمات</h3>
              <p className="stat-number">{khatmaStats.khatmaCount}</p>
            </article>
            <article className="card">
              <h3>الأجزاء الحالية</h3>
              <p className="stat-number">
                {reservedPartsCount} / {QURAN_TOTAL_PARTS}
              </p>
            </article>
            <article className="card">
              <h3>الأجزاء المقروءة إجمالًا</h3>
              <p className="stat-number">{khatmaStats.totalPartsRead}</p>
            </article>
          </div>
          <div className="khatma-parts-grid admin-khatma-grid">
            {Array.from({ length: QURAN_TOTAL_PARTS }, (_, idx) => idx + 1).map((part) => {
              const item = khatmaParts.find((row) => row.partNumber === part)
              const isReserved = Boolean(item?.reservedByMemberId)
              return (
                <article
                  key={`admin-part-${part}`}
                  className={`khatma-part-card ${isReserved ? 'khatma-part-reserved' : ''}`}
                >
                  <h4>الجزء {part}</h4>
                  <p className={isReserved ? 'khatma-reserver-name' : ''}>
                    {isReserved ? item?.reservedByName || 'عضو' : 'غير محجوز'}
                  </p>
                  {isReserved ? (
                    <button
                      type="button"
                      className="btn btn-cancel-outline"
                      onClick={() => adminCancelKhatmaPartReservation(part)}
                    >
                      إلغاء الحجز
                    </button>
                  ) : null}
                </article>
              )
            })}
          </div>
          <div className="admin-actions-wrap khatma-complete-wrap">
            <button
              type="button"
              className="btn btn-primary"
              onClick={completeGroupKhatma}
              disabled={!isKhatmaComplete}
            >
              إنهاء الختمة الحالية
            </button>
            {!isKhatmaComplete ? (
              <p className="subtle-note khatma-complete-note">
                لا يمكن الإنهاء قبل حجز جميع الأجزاء (المتبقي {QURAN_TOTAL_PARTS - reservedPartsCount}).
              </p>
            ) : null}
          </div>
        </section>

        <section className="section">
          <h2>إدارة الأعضاء</h2>
          {authError ? <p className="error-text">{authError}</p> : null}
          <div className="cards admin-summary-cards">
            <article className="card">
              <span className="card-icon card-icon-custom">
                <TasbeehIcon />
              </span>
              <h3>الاستغفارات الكلية</h3>
              <p className="stat-number">{totals.istighfar}</p>
            </article>
            <article className="card">
              <span className="card-icon card-icon-custom">
                <DomeIcon />
              </span>
              <h3>الصلاة على النبي الكلية</h3>
              <p className="stat-number">{totals.salawat}</p>
            </article>
            <article className="card">
              <span className="card-icon card-icon-custom">
                <OpenBookIcon />
              </span>
              <h3>الأجزاء الكلية</h3>
              <p className="stat-number">{totals.quranParts}</p>
            </article>
          </div>

          <div className="period-top-grid">
            <article className="card period-card">
              <h3>Top 3 اليوم</h3>
              <div className="period-list metric-board">
                {renderTopMetricList('الاستغفار', topBoards.day.istighfar, 'd-i')}
                {renderTopMetricList('الصلاة على النبي', topBoards.day.salawat, 'd-s')}
                {renderTopMetricList('الأجزاء', topBoards.day.quranParts, 'd-q')}
              </div>
            </article>
            <article className="card period-card">
              <h3>Top 3 هذا الأسبوع</h3>
              <div className="period-list metric-board">
                {renderTopMetricList('الاستغفار', topBoards.week.istighfar, 'w-i')}
                {renderTopMetricList('الصلاة على النبي', topBoards.week.salawat, 'w-s')}
                {renderTopMetricList('الأجزاء', topBoards.week.quranParts, 'w-q')}
              </div>
            </article>
            <article className="card period-card">
              <h3>Top 3 هذا الشهر</h3>
              <div className="period-list metric-board">
                {renderTopMetricList('الاستغفار', topBoards.month.istighfar, 'm-i')}
                {renderTopMetricList('الصلاة على النبي', topBoards.month.salawat, 'm-s')}
                {renderTopMetricList('الأجزاء', topBoards.month.quranParts, 'm-q')}
              </div>
            </article>
          </div>

          <div className="admin-toolbar">
            <input
              type="text"
              placeholder="ابحث بالاسم أو البلد أو المحافظة"
              value={adminSearch}
              onChange={(event) => setAdminSearch(event.target.value)}
            />
          </div>
          <div className="admin-table">
            <div className="admin-row admin-head">
              <span>#</span>
              <span>الاسم</span>
              <span>البلد</span>
              <span>المحافظة</span>
              <span>الحالة</span>
              <span>استغفار</span>
              <span>صلاة على النبي</span>
              <span>أجزاء القران</span>
              <span>إجراءات</span>
            </div>
            {filteredAdminMembers.map((member, index) => {
              const draft = adminDrafts[member.id] || {}
              const banInfo = getMemberBanInfo(member.id)
              return (
                <div className="admin-row" key={member.id}>
                  <span>{index + 1}</span>
                  <input
                    type="text"
                    value={draft.fullName ?? member.fullName}
                    onChange={(event) =>
                      updateAdminDraft(member.id, 'fullName', event.target.value)
                    }
                  />
                  <span>{member.country || 'العراق'}</span>
                  <span>{member.governorate || '-'}</span>
                  <span
                    className={`ban-status ${banInfo.isBanned ? 'ban-status-active' : 'ban-status-clear'}`}
                  >
                    {banInfo.label}
                    {banInfo.isBanned ? ` - ${banInfo.remainingText}` : ''}
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={draft.istighfar ?? member.stats.istighfar}
                    onChange={(event) =>
                      updateAdminDraft(member.id, 'istighfar', event.target.value)
                    }
                  />
                  <input
                    type="number"
                    min="0"
                    value={draft.salawat ?? member.stats.salawat}
                    onChange={(event) =>
                      updateAdminDraft(member.id, 'salawat', event.target.value)
                    }
                  />
                  <input
                    type="number"
                    min="0"
                    value={draft.quranParts ?? member.stats.quranParts}
                    onChange={(event) =>
                      updateAdminDraft(member.id, 'quranParts', event.target.value)
                    }
                  />
                  <div className="admin-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => saveAdminStats(member)}
                    >
                      حفظ
                    </button>
                    <button
                      type="button"
                      className="btn btn-muted"
                      onClick={() => resetMemberStats(member)}
                    >
                      تصفير
                    </button>
                    <button
                      type="button"
                      className="btn btn-info"
                      onClick={() => liftMemberBan(member)}
                    >
                      رفع الحظر
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => setMemberRestriction(member, 'ban')}
                    >
                      حظر الحساب
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => setMemberRestriction(member, 'freeze')}
                    >
                      تجميد الحساب
                    </button>
                    <button
                      type="button"
                      className="btn btn-cancel-outline"
                      onClick={() => cancelMemberKhatmaReservations(member)}
                    >
                      إلغاء حجز الختمة
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => deleteMemberAccount(member)}
                    >
                      حذف
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
        {siteNoticeModal}
        <footer className="footer">جميع الحقوق محفوضة الى مؤسسة زهرة المنتظر 2026</footer>
      </main>
    )
  }

  return (
    <main className="page" dir="rtl">
      <header className="hero">
        <span className="badge badge-brand">
          <SiteLogo size={20} />
          بنك الحسنات
        </span>
        <h1>بنك الحسنات</h1>
        <p>
          بنك الحسنات منصة رقمية تجمع المؤمنين للمشاركة في التسبيح والاستغفار والصلوات وختمات القرآن بشكل جماعي، حيث يساهم كل شخص بذكرٍ بسيط ليجتمع الأجر في عمل كبير. نسعى من خلال هذه الأعمال الصالحة إلى نشر الذكر والطاعة وتهيئة القلوب بالإيمان والعمل الصالح تمهيدًا لنصرة وظهور صاحب العصر والزمان (عجل الله فرجه الشريف).
        </p>
      </header>

      <section className="section">
        <h2>الدخول أو إنشاء حساب عضو</h2>
        {!isSupabaseConfigured ? (
          <p className="error-text">
            لم يتم ضبط Supabase بعد. أضف المفاتيح في ملف البيئة لتفعيل التسجيل الحقيقي.
          </p>
        ) : null}

        <div className="auth-switch">
          <button
            type="button"
            className={`btn ${authMode === 'login' ? 'btn-primary' : 'btn-muted'}`}
            onClick={() => {
              setAuthMode('login')
              setAuthError('')
              setAuthSuccess('')
            }}
          >
            تسجيل الدخول
          </button>
          <button
            type="button"
            className={`btn ${authMode === 'register' ? 'btn-primary' : 'btn-muted'}`}
            onClick={() => {
              setAuthMode('register')
              setAuthError('')
              setAuthSuccess('')
            }}
          >
            إنشاء حساب جديد
          </button>
        </div>

        {authMode === 'register' ? (
          <form className="login-card" onSubmit={registerUser}>
            <label htmlFor="registerFullName">الاسم الثلاثي أو اسمًا رمزيًا</label>
            <input
              id="registerFullName"
              name="fullName"
              type="text"
              placeholder="مثال: محمد أحمد أو سراج الهدى"
              value={registerForm.fullName}
              onChange={updateRegisterForm}
            />

            <label htmlFor="registerCountry">البلد</label>
            <select
              id="registerCountry"
              name="country"
              value={registerForm.country}
              onChange={updateRegisterForm}
            >
              {WORLD_COUNTRY_OPTIONS.map((countryName) => (
                <option key={countryName} value={countryName}>
                  {countryName}
                </option>
              ))}
            </select>

            <label htmlFor="registerGovernorate">
              المحافظة {registerForm.country.trim() !== 'العراق' ? '(اختياري)' : ''}
            </label>
            {registerForm.country.trim() === 'العراق' ? (
              <select
                id="registerGovernorate"
                name="governorate"
                value={registerForm.governorate}
                onChange={updateRegisterForm}
              >
                <option value="">اختر المحافظة</option>
                {IRAQ_GOVERNORATES.map((gov) => (
                  <option key={gov} value={gov}>
                    {gov}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="registerGovernorate"
                name="governorate"
                type="text"
                placeholder="اختياري"
                value={registerForm.governorate}
                onChange={updateRegisterForm}
              />
            )}

            <label htmlFor="registerPassword">كلمة السر</label>
            <div className="password-field">
              <input
                id="registerPassword"
                name="password"
                type={showRegisterPassword ? 'text' : 'password'}
                placeholder="******"
                value={registerForm.password}
                onChange={updateRegisterForm}
              />
              <button
                type="button"
                className="btn btn-muted password-toggle"
                onClick={() => setShowRegisterPassword((prev) => !prev)}
              >
                {showRegisterPassword ? 'إخفاء' : 'إظهار'}
              </button>
            </div>

            {authError ? <p className="error-text">{authError}</p> : null}
            {authSuccess ? <p className="success-text">{authSuccess}</p> : null}

            <button
              type="submit"
              className="btn btn-primary login-btn"
              disabled={isSubmitting || !isSupabaseConfigured}
            >
              إنشاء الحساب
            </button>
          </form>
        ) : (
          <form className="login-card" onSubmit={handleLogin}>
            <label htmlFor="loginFullName">الاسم</label>
            <input
              id="loginFullName"
              name="fullName"
              type="text"
              placeholder="اكتب اسمك المسجل"
              value={loginForm.fullName}
              onChange={updateLoginForm}
            />

            <label htmlFor="loginPassword">كلمة السر</label>
            <div className="password-field">
              <input
                id="loginPassword"
                name="password"
                type={showLoginPassword ? 'text' : 'password'}
                placeholder="******"
                value={loginForm.password}
                onChange={updateLoginForm}
              />
              <button
                type="button"
                className="btn btn-muted password-toggle"
                onClick={() => setShowLoginPassword((prev) => !prev)}
              >
                {showLoginPassword ? 'إخفاء' : 'إظهار'}
              </button>
            </div>

            {authError ? <p className="error-text">{authError}</p> : null}
            {authSuccess ? <p className="success-text">{authSuccess}</p> : null}

            <button
              type="submit"
              className="btn btn-primary login-btn"
              disabled={isSubmitting}
            >
              دخول
            </button>
          </form>
        )}
      </section>

      {siteNoticeModal}
      <footer className="footer">جميع الحقوق محفوضة الى مؤسسة زهرة المنتظر 2026</footer>
    </main>
  )
}

export default App
