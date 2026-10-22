// Preset endpoint MAL API v2.
// Referensi: https://myanimelist.net/apiconfig/references/api/v2
//
// Row format: { k, v, off?, options? }
//   off     -> default tidak dicentang (tidak dikirim)
//   options -> key di OPTIONS untuk autocomplete nilai

const ANIME_LIST_FIELDS = 'id,title,main_picture,mean,rank,popularity,media_type,status,num_episodes,start_season,my_list_status';
const ANIME_DETAIL_FIELDS = [
  'id', 'title', 'main_picture', 'alternative_titles', 'start_date', 'end_date', 'synopsis', 'mean', 'rank',
  'popularity', 'num_list_users', 'num_scoring_users', 'nsfw', 'created_at', 'updated_at', 'media_type', 'status',
  'genres', 'my_list_status', 'num_episodes', 'start_season', 'broadcast', 'source', 'average_episode_duration',
  'rating', 'pictures', 'background', 'related_anime', 'related_manga', 'recommendations', 'studios', 'statistics',
].join(',');
const MANGA_LIST_FIELDS = 'id,title,main_picture,mean,rank,popularity,media_type,status,num_volumes,num_chapters,my_list_status';
const MANGA_DETAIL_FIELDS = [
  'id', 'title', 'main_picture', 'alternative_titles', 'start_date', 'end_date', 'synopsis', 'mean', 'rank',
  'popularity', 'num_list_users', 'num_scoring_users', 'nsfw', 'created_at', 'updated_at', 'media_type', 'status',
  'genres', 'my_list_status', 'num_volumes', 'num_chapters', 'authors{first_name,last_name}', 'pictures',
  'background', 'related_anime', 'related_manga', 'recommendations', 'serialization{name}',
].join(',');

const SEASONS = ['winter', 'spring', 'summer', 'fall'];
const now = new Date();
const CURRENT_YEAR = String(now.getFullYear());
const CURRENT_SEASON = SEASONS[Math.floor(now.getMonth() / 3)];

export const OPTIONS = {
  animeRanking: ['all', 'airing', 'upcoming', 'tv', 'ova', 'movie', 'special', 'bypopularity', 'favorite'],
  mangaRanking: ['all', 'manga', 'novels', 'oneshots', 'doujin', 'manhwa', 'manhua', 'bypopularity', 'favorite'],
  season: SEASONS,
  seasonSort: ['anime_score', 'anime_num_list_users'],
  animeStatus: ['watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch'],
  mangaStatus: ['reading', 'completed', 'on_hold', 'dropped', 'plan_to_read'],
  animeListSort: ['list_score', 'list_updated_at', 'anime_title', 'anime_start_date'],
  mangaListSort: ['list_score', 'list_updated_at', 'manga_title', 'manga_start_date'],
  bool: ['true', 'false'],
  score: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
  priority: ['0', '1', '2'],
  value: ['0', '1', '2', '3', '4', '5'],
};

const paging = (limit) => [
  { k: 'limit', v: String(limit) },
  { k: 'offset', v: '0' },
];

export const ENDPOINTS = [
  // ----------------------------------------------------------------- Anime
  {
    id: 'anime-search', group: 'Anime', name: 'Search anime',
    method: 'GET', path: '/anime', auth: 'public',
    doc: 'Cari anime berdasarkan judul. "fields" menentukan data apa saja yang dikembalikan.',
    query: [{ k: 'q', v: 'frieren' }, ...paging(10), { k: 'fields', v: ANIME_LIST_FIELDS }, { k: 'nsfw', v: 'true', off: true, options: 'bool' }],
  },
  {
    id: 'anime-details', group: 'Anime', name: 'Anime details',
    method: 'GET', path: '/anime/{anime_id}', auth: 'public',
    doc: 'Detail lengkap satu anime (52991 = Frieren). Klik kartu di hasil search/ranking untuk membuka detail.',
    params: [{ k: 'anime_id', v: '52991' }],
    query: [{ k: 'fields', v: ANIME_DETAIL_FIELDS }],
  },
  {
    id: 'anime-ranking', group: 'Anime', name: 'Anime ranking',
    method: 'GET', path: '/anime/ranking', auth: 'public',
    doc: 'Top anime berdasarkan ranking_type.',
    query: [{ k: 'ranking_type', v: 'all', options: 'animeRanking' }, ...paging(10), { k: 'fields', v: ANIME_LIST_FIELDS }],
  },
  {
    id: 'anime-season', group: 'Anime', name: 'Seasonal anime',
    method: 'GET', path: '/anime/season/{year}/{season}', auth: 'public',
    doc: 'Anime per musim. season: winter (Jan-Mar), spring (Apr-Jun), summer (Jul-Sep), fall (Oct-Dec).',
    params: [{ k: 'year', v: CURRENT_YEAR }, { k: 'season', v: CURRENT_SEASON, options: 'season' }],
    query: [{ k: 'sort', v: 'anime_num_list_users', options: 'seasonSort' }, ...paging(20), { k: 'fields', v: ANIME_LIST_FIELDS }, { k: 'nsfw', v: 'true', off: true, options: 'bool' }],
  },
  {
    id: 'anime-suggestions', group: 'Anime', name: 'Suggested anime',
    method: 'GET', path: '/anime/suggestions', auth: 'user',
    doc: 'Rekomendasi anime untuk user yang login.',
    query: [...paging(10), { k: 'fields', v: ANIME_LIST_FIELDS }],
  },
  {
    id: 'anime-update-list', group: 'Anime', name: 'Update my anime list',
    method: 'PATCH', path: '/anime/{anime_id}/my_list_status', auth: 'user',
    doc: 'Tambah/ubah entri anime di list akun yang login. Hanya field yang dicentang yang dikirim. PERHATIAN: ini mengubah list MAL asli kamu.',
    params: [{ k: 'anime_id', v: '52991' }],
    body: [
      { k: 'status', v: 'watching', options: 'animeStatus' },
      { k: 'score', v: '9', options: 'score' },
      { k: 'num_watched_episodes', v: '1' },
      { k: 'is_rewatching', v: 'false', off: true, options: 'bool' },
      { k: 'priority', v: '0', off: true, options: 'priority' },
      { k: 'num_times_rewatched', v: '0', off: true },
      { k: 'rewatch_value', v: '0', off: true, options: 'value' },
      { k: 'tags', v: '', off: true },
      { k: 'comments', v: '', off: true },
    ],
  },
  {
    id: 'anime-delete-list', group: 'Anime', name: 'Delete from my anime list',
    method: 'DELETE', path: '/anime/{anime_id}/my_list_status', auth: 'user',
    doc: 'Hapus anime dari list akun yang login (404 kalau tidak ada di list). PERHATIAN: mengubah data asli.',
    params: [{ k: 'anime_id', v: '52991' }],
  },

  // ----------------------------------------------------------------- Manga
  {
    id: 'manga-search', group: 'Manga', name: 'Search manga',
    method: 'GET', path: '/manga', auth: 'public',
    doc: 'Cari manga / light novel berdasarkan judul.',
    query: [{ k: 'q', v: 'berserk' }, ...paging(10), { k: 'fields', v: MANGA_LIST_FIELDS }, { k: 'nsfw', v: 'true', off: true, options: 'bool' }],
  },
  {
    id: 'manga-details', group: 'Manga', name: 'Manga details',
    method: 'GET', path: '/manga/{manga_id}', auth: 'public',
    doc: 'Detail lengkap satu manga (2 = Berserk).',
    params: [{ k: 'manga_id', v: '2' }],
    query: [{ k: 'fields', v: MANGA_DETAIL_FIELDS }],
  },
  {
    id: 'manga-ranking', group: 'Manga', name: 'Manga ranking',
    method: 'GET', path: '/manga/ranking', auth: 'public',
    doc: 'Top manga berdasarkan ranking_type.',
    query: [{ k: 'ranking_type', v: 'all', options: 'mangaRanking' }, ...paging(10), { k: 'fields', v: MANGA_LIST_FIELDS }],
  },
  {
    id: 'manga-update-list', group: 'Manga', name: 'Update my manga list',
    method: 'PATCH', path: '/manga/{manga_id}/my_list_status', auth: 'user',
    doc: 'Tambah/ubah entri manga di list akun yang login. PERHATIAN: mengubah data asli.',
    params: [{ k: 'manga_id', v: '2' }],
    body: [
      { k: 'status', v: 'reading', options: 'mangaStatus' },
      { k: 'score', v: '10', options: 'score' },
      { k: 'num_chapters_read', v: '1' },
      { k: 'num_volumes_read', v: '0', off: true },
      { k: 'is_rereading', v: 'false', off: true, options: 'bool' },
      { k: 'priority', v: '0', off: true, options: 'priority' },
      { k: 'num_times_reread', v: '0', off: true },
      { k: 'reread_value', v: '0', off: true, options: 'value' },
      { k: 'tags', v: '', off: true },
      { k: 'comments', v: '', off: true },
    ],
  },
  {
    id: 'manga-delete-list', group: 'Manga', name: 'Delete from my manga list',
    method: 'DELETE', path: '/manga/{manga_id}/my_list_status', auth: 'user',
    doc: 'Hapus manga dari list akun yang login. PERHATIAN: mengubah data asli.',
    params: [{ k: 'manga_id', v: '2' }],
  },

  // ------------------------------------------------------------------ User
  {
    id: 'user-me', group: 'User', name: 'My profile',
    method: 'GET', path: '/users/@me', auth: 'user',
    doc: 'Profil akun yang login. Saat ini MAL hanya mendukung @me.',
    query: [{ k: 'fields', v: 'anime_statistics' }],
  },
  {
    id: 'user-animelist', group: 'User', name: 'User anime list',
    method: 'GET', path: '/users/{user_name}/animelist', auth: 'public',
    doc: '@me butuh login. Username lain bisa diakses dengan Client ID saja (kalau list-nya publik).',
    params: [{ k: 'user_name', v: '@me' }],
    query: [
      { k: 'status', v: 'watching', off: true, options: 'animeStatus' },
      { k: 'sort', v: 'list_updated_at', options: 'animeListSort' },
      ...paging(10),
      { k: 'fields', v: 'list_status,mean,media_type,num_episodes' },
      { k: 'nsfw', v: 'true', off: true, options: 'bool' },
    ],
  },
  {
    id: 'user-mangalist', group: 'User', name: 'User manga list',
    method: 'GET', path: '/users/{user_name}/mangalist', auth: 'public',
    doc: '@me butuh login. Username lain bisa diakses dengan Client ID saja (kalau list-nya publik).',
    params: [{ k: 'user_name', v: '@me' }],
    query: [
      { k: 'status', v: 'reading', off: true, options: 'mangaStatus' },
      { k: 'sort', v: 'list_updated_at', options: 'mangaListSort' },
      ...paging(10),
      { k: 'fields', v: 'list_status,mean,media_type,num_chapters' },
      { k: 'nsfw', v: 'true', off: true, options: 'bool' },
    ],
  },

  // ----------------------------------------------------------------- Forum
  {
    id: 'forum-boards', group: 'Forum', name: 'Forum boards',
    method: 'GET', path: '/forum/boards', auth: 'public',
    doc: 'Daftar board forum. Klik board di preview untuk melihat topiknya.',
  },
  {
    id: 'forum-topics', group: 'Forum', name: 'Forum topics',
    method: 'GET', path: '/forum/topics', auth: 'public',
    doc: 'Cari topik forum. Klik topik di preview untuk membuka isinya.',
    query: [
      { k: 'q', v: 'frieren' },
      { k: 'board_id', v: '', off: true },
      { k: 'subboard_id', v: '', off: true },
      ...paging(10),
      { k: 'sort', v: 'recent', off: true },
      { k: 'topic_user_name', v: '', off: true },
      { k: 'user_name', v: '', off: true },
    ],
  },
  {
    id: 'forum-topic', group: 'Forum', name: 'Forum topic detail',
    method: 'GET', path: '/forum/topic/{topic_id}', auth: 'public',
    doc: 'Isi satu topik. Ambil topic_id dari hasil "Forum topics".',
    params: [{ k: 'topic_id', v: '' }],
    query: paging(10),
  },
];
