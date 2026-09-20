import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, AlertTriangle } from 'lucide-react';
import { swordsmanApi, swordApi } from '../api';
import type { Swordsman, Sword } from '../types';

/**
 * 剑客详情：读取剑客及其佩剑。
 * 佩剑 id 在名剑谱中查无对应时（断链），明确标注「剑已佚」而不抛错。
 */
export default function SwordsmanDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [swordsman, setSwordsman] = useState<Swordsman | null>(null);
  const [swords, setSwords] = useState<{ sword?: Sword; refId: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const man = await swordsmanApi.getSwordsmanById(id);
        if (cancelled) return;
        setSwordsman(man);
        const settled = await Promise.all(
          (man.swords || []).map(async (refId) => {
            try {
              return { sword: await swordApi.getSwordById(refId), refId };
            } catch {
              return { refId };
            }
          }),
        );
        if (!cancelled) setSwords(settled);
      } catch (err) {
        console.error('剑客加载失败', err);
        if (!cancelled) setSwordsman(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center font-song text-ink-600">
        正在寻此人踪迹……
      </div>
    );
  }

  if (!swordsman) {
    return (
      <div className="min-h-screen pt-24 flex flex-col items-center justify-center gap-4 font-song text-ink-700">
        <h2 className="font-brush text-3xl">剑客未找到</h2>
        <p className="text-ink-500">此人已湮没于江湖。</p>
        <button
          onClick={() => navigate('/swordsmen')}
          className="px-6 py-2 bg-cinnabar-600 text-ink-100"
        >
          返回剑客谱
        </button>
      </div>
    );
  }

  return (
    <div className="pt-24 pb-16 container mx-auto px-4 max-w-4xl">
      <Link
        to="/chronicle"
        className="inline-flex items-center gap-2 text-sm text-ink-700 hover:text-cinnabar-700 font-song mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> 回到编年史
      </Link>

      <div className="ink-card p-6 md:p-8 flex flex-col md:flex-row gap-6">
        <img
          src={swordsman.avatarUrl}
          alt={swordsman.name}
          className="w-40 h-40 object-cover border border-ink-300 shrink-0"
          loading="lazy"
        />
        <div className="flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="font-brush text-4xl text-ink-900">{swordsman.name}</h1>
            <span className="text-cinnabar-700 font-song">「{swordsman.title}」</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm text-ink-700 font-song">
            <span>{swordsman.dynasty || '朝代失考'}</span>
            <span className="inline-flex items-center gap-1">
              <Building2 className="w-4 h-4" />{swordsman.sect || '门派失考'}
            </span>
          </div>
          <p className="mt-4 text-sm leading-loose text-ink-800 font-song">{swordsman.biography}</p>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="font-brush text-2xl text-ink-900 mb-4">佩剑</h2>
        {swords.length === 0 ? (
          <p className="text-sm text-ink-600 font-song">
            史无载其佩剑——或剑出无名，或唯以竹枝木剑行世。
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {swords.map(({ sword, refId }) =>
              sword ? (
                <Link
                  key={refId}
                  to={`/swords/${sword.id}`}
                  className="ink-card p-4 flex items-center gap-3"
                >
                  <img
                    src={sword.imageUrl}
                    alt={sword.name}
                    className="w-14 h-14 object-cover border border-ink-300"
                    loading="lazy"
                  />
                  <div>
                    <div className="font-brush text-xl text-ink-900">{sword.name}</div>
                    <div className="text-xs text-ink-600">{sword.alias}</div>
                  </div>
                </Link>
              ) : (
                <div
                  key={refId}
                  className="p-4 flex items-center gap-3 border border-dashed border-cinnabar-400 bg-cinnabar-50"
                >
                  <AlertTriangle className="w-5 h-5 text-cinnabar-600 shrink-0" />
                  <div className="text-sm font-song text-cinnabar-800">
                    佩剑编号 <code>{refId}</code> 在名剑谱中查无对应——剑已佚，唯存其名。
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
