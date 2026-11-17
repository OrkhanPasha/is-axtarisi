# Vakansiya paneli — tələblər

İş axtarışındakı bütün vakansiyaları və müraciət statuslarını bir səhifədə göstərən şəxsi panel.

## 1. Ümumi qərarlar

| Mövzu | Qərar |
|---|---|
| Platforma | Tək lokal HTML fayl, brauzerdə açılır. Server, quraşdırma, internet tələb olunmur. |
| Məlumat mənbəyi | Bir JSON fayl (`vacancies.json`), formatı aşağıdadır. |
| Məlumat daxil etmə | Panel içindəki forma **və** JSON-u əllə redaktə etmək — hər ikisi işləməlidir. |
| İnterfeys dili | İngilis dili. |
| Həcm | 500-dən çox vakansiya; arxivləşdirmə və sürətli filtr vacibdir. |
| Status tarixçəsi | Tam saxlanılır, hər dəyişiklik tarixlə. |

## 2. Fayl ilə işləmə

- Brauzer `file://` səhifəsindən yanındakı JSON-u avtomatik oxuya bilmir, ona görə JSON fayl **"Open file" düyməsi** və ya **sürüklə-burax** ilə açılır.
- Saxlama:
  - Chrome/Edge-də eyni fayla birbaşa yazılır (File System Access API).
  - Digər brauzerlərdə "Export" yenilənmiş JSON-u yükləmə kimi verir.
- Yadda saxlanmamış dəyişiklik olanda başlıqda xəbərdarlıq görünür. Səhifə bağlananda da təsdiq soruşulur.
- Hər saxlamadan əvvəl köhnə versiya `vacancies.backup.json` kimi saxlanılır (birbaşa yazma rejimində).
- JSON yüklənəndə yoxlanılır. Səhv qeydlər (məs. tanınmayan status, səhv tarix) siyahı ilə göstərilir, qalan qeydlər yenə də yüklənir.

## 3. Statuslar

Sıra ilə (pipeline):

| Kod | Ekranda | Növ |
|---|---|---|
| `saved` | Saved | aktiv |
| `applied` | Applied | aktiv |
| `hr_screen` | HR Screen | aktiv |
| `test_task` | Test Task | aktiv |
| `interview` | Interview | aktiv |
| `offer` | Offer | aktiv |
| `rejected` | Rejected | bağlı |
| `withdrawn` | Withdrawn | bağlı |
| `no_response` | No Response | bağlı |

- Cari status = `statusHistory`-nin **ən son tarixli** qeydi. Ayrıca `status` sahəsi yoxdur, ona görə ikisi bir-birinə zidd ola bilməz.
- Status dəyişəndə tarixçəyə yeni qeyd əlavə olunur (tarix default olaraq bu gün, dəyişdirilə bilər; qeyd isə istəyə bağlıdır).
- Mərhələ atlamaq olar (məs. `applied` → `interview`). Bağlı statusdan geri qayıtmaq da olar.

## 4. Görünüşlər

Yuxarıda tab-lar: **Table · Board · Stats · Reminders**. Filtrlər bütün görünüşlər üçün ortaqdır.

### 4.1 Ümumi filtrlər
- Mətn axtarışı: vəzifə, şirkət, qeydlər, teqlər.
- Status (bir neçəsi seçilə bilər), ölkə, şəhər, iş rejimi, mənbə, prioritet, teq.
- Tarix aralığı (müraciət tarixi).
- "Show archived" — default olaraq arxivlənmişlər gizlidir.
- Filtr vəziyyəti `localStorage`-da yadda qalır.

### 4.2 Table (cədvəl)
- Sütunlar: Title, Company, Location, Work mode, Salary, Status, Applied, Last update, Next action, Priority.
- İstənilən sütuna görə sıralama.
- 500+ qeyddə ləngimir (səhifələmə və ya virtual scroll).
- Sətrə klik → detal paneli (bütün sahələr, tarixçə, müsahibələr, əlaqələr) və redaktə.

### 4.3 Board (Kanban)
- Hər aktiv status üçün bir sütun. Bağlı statuslar bir "Closed" sütununda yığılıb göstərilir (açıla bilər).
- Kartı sürükləyib başqa sütuna buraxmaq status dəyişikliyi yaradır (tarixçəyə yazılır).
- Kartda: vəzifə, şirkət, prioritet, son dəyişiklikdən keçən gün sayı.

### 4.4 Stats (statistika)
- Hər statusda neçə vakansiya var.
- Funnel: Applied → HR Screen → Interview → Offer (say və faiz). Hesablama tarixçəyə görədir: hazırda `rejected` olan, amma əvvəl müsahibədən keçmiş vakansiya da müsahibə sayına düşür.
- Cavab faizi: `applied`-dan sonra `hr_screen` və ya daha irəli mərhələyə, ya da `rejected`-ə keçənlərin payı.
- Müraciətdən ilk cavaba qədər orta gün sayı.
- Həftəlik müraciət sayı (qrafik).
- Mənbə üzrə bölgü və hər mənbənin cavab faizi.
- Statistika aktiv filtrlərə uyğun hesablanır.

### 4.5 Reminders (xatırlatmalar)
Aşağıdakı vəziyyətlər siyahıda göstərilir, ən təcili olan yuxarıda olur:
- Müraciət son tarixi (`deadline`) ≤ 3 gün qalıb və status hələ `saved`-dir.
- Müsahibə növbəti 7 gündədir.
- `nextFollowUp` tarixi bu gün və ya keçib.
- `applied` statusunda `followUpDays` (default 7) gündən çoxdur, dəyişiklik yoxdur → "follow up" tövsiyəsi.
- `applied` statusunda `noResponseDays` (default 30) gündən çoxdur → `no_response` təklifi. Status **avtomatik dəyişmir**, bir kliklə təsdiqlənir.
- Reminders tab-ında açıq xatırlatmaların sayı nişan kimi görünür.

## 5. Redaktə formu

- Yeni vakansiya: yalnız `title` və `company` məcburidir. Default status `saved`-dir, ya da formada `applied` seçilə bilər.
- Bütün sahələr redaktə olunur. Əlaqələr və müsahibələr siyahı kimi əlavə/silinir.
- Vakansiyanı silmək təsdiq tələb edir. Silmək əvəzinə arxivləşdirmək təklif olunur.
- Eyni `url`, yaxud eyni şirkət+vəzifə ilə ikinci qeyd yaradılanda dublikat xəbərdarlığı çıxır.
- Sənədlər (CV / cover letter) ayrıca siyahıda saxlanılır. Vakansiyada onlardan biri seçilir.

## 6. JSON formatı

Qaydalar:
- Tarixlər `YYYY-MM-DD`, vaxt lazım olanda `YYYY-MM-DDTHH:mm`.
- Boş sahə `null` və ya buraxılmış ola bilər. Yalnız `id`, `title`, `company` və `statusHistory` (ən azı 1 qeyd) məcburidir.
- `id` unikal sətirdir. Əllə əlavə edəndə istənilən unikal dəyər olar, panel `v-0001` formatında yaradır.
- `schemaVersion` gələcəkdə format dəyişəndə köhnə faylları çevirmək üçündür.

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-11-17T20:45",
  "settings": {
    "defaultCurrency": "USD",
    "followUpDays": 7,
    "noResponseDays": 30
  },
  "documents": [
    { "id": "cv-data-analyst-v3", "type": "cv", "name": "CV – Data Analyst v3", "file": "Resume/CV_DataAnalyst_v3.pdf" },
    { "id": "cl-generic-en", "type": "cover_letter", "name": "Cover letter – generic EN", "file": null }
  ],
  "vacancies": [
    {
      "id": "v-0001",
      "title": "Data Analyst",
      "company": "Example LLC",
      "url": "https://example.com/jobs/123",
      "source": "LinkedIn",
      "location": { "city": "Baku", "country": "Azerbaijan", "workMode": "hybrid" },
      "salary": { "min": 2500, "max": 3500, "currency": "AZN", "period": "month" },
      "priority": 1,
      "tags": ["power-bi", "sql"],
      "dates": {
        "posted": "2026-11-01",
        "deadline": "2026-11-30",
        "applied": "2026-11-05",
        "nextFollowUp": "2026-11-19"
      },
      "statusHistory": [
        { "status": "saved",     "date": "2026-11-02", "note": null },
        { "status": "applied",   "date": "2026-11-05", "note": "Applied via company site" },
        { "status": "hr_screen", "date": "2026-11-10", "note": "15-min call with HR" },
        { "status": "interview", "date": "2026-11-14", "note": null }
      ],
      "contacts": [
        { "name": "Aysel M.", "role": "Recruiter", "email": "aysel@example.com", "phone": null, "linkedin": null }
      ],
      "documentsSent": { "cv": "cv-data-analyst-v3", "coverLetter": "cl-generic-en" },
      "interviews": [
        {
          "date": "2026-11-20T11:00",
          "type": "technical",
          "with": "Team lead",
          "notes": "SQL + Power BI case",
          "outcome": "pending"
        }
      ],
      "notes": "Good team, salary negotiable.",
      "archived": false,
      "createdAt": "2026-11-02",
      "updatedAt": "2026-11-14"
    }
  ]
}
```

İcazə verilən dəyərlər:

| Sahə | Dəyərlər |
|---|---|
| `statusHistory[].status` | bölmə 3-dəki kodlar |
| `location.workMode` | `onsite`, `hybrid`, `remote` |
| `salary.period` | `hour`, `month`, `year` |
| `salary.currency` | ISO kod: `AZN`, `USD`, `EUR`, `CAD`, … |
| `priority` | `1` (yüksək), `2`, `3` (aşağı) |
| `documents[].type` | `cv`, `cover_letter`, `other` |
| `interviews[].type` | `phone`, `video`, `onsite`, `technical`, `hr`, `final` |
| `interviews[].outcome` | `pending`, `passed`, `failed`, `cancelled` |
| `source` | sərbəst mətn (məs. LinkedIn, hh.az, boss.az, Indeed, Referral). Formada əvvəl istifadə olunanlar təklif olunur. |

## 7. Əhatədən kənar (bu versiyada yoxdur)

- Vakansiya saytlarından avtomatik çəkmə (scraping) və ya e-poçtdan oxuma.
- Bulud sinxronizasiyası, bir neçə istifadəçi.
- E-poçt/push bildirişləri — xatırlatmalar yalnız panel açıq olanda görünür.
- Valyuta çevirmə — maaşlar öz valyutasında göstərilir, fərqli valyutalar bir-biri ilə müqayisə edilmir.
- Excel/CSV ixracı — yalnız JSON.
- Mövcud müraciətlərin köçürülməsi — panel boş JSON ilə başlayır.

## 8. Təsdiqlənmiş parametrlər

- Default valyuta: `USD` (yeni vakansiya formasında avtomatik seçilir, dəyişdirilə bilər).
- Reminders həddləri: deadline 3 gün, müsahibə 7 gün, follow-up 7 gün, no response 30 gün.
- Başlanğıc fayl: boş `vacancies.json` (`"vacancies": []`). Fayl yoxdursa, panel "New file" ilə yaradır.
