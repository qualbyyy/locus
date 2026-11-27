import { useState } from 'react';
import {
  APP_INFO,
  formatDiagnostics,
  getRuntimeDiagnostics,
  type AppContactLink,
} from '../../core/appInfo';
import { openExternalUrl } from '../../platform/io';

function AboutRow({
  label,
  value,
  links,
  onOpenLink,
}: {
  label: string;
  value?: string;
  links?: AppContactLink[];
  onOpenLink?: (url: string) => void;
}) {
  return (
    <>
      <dt className="text-paper-muted">{label}</dt>
      <dd className="break-all text-paper-ink">
        {value}
        {links && links.length > 0 && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {links.map((link) => (
              <button
                key={link.url}
                type="button"
                onClick={() => onOpenLink?.(link.url)}
                className="text-paper-accent underline underline-offset-2 hover:text-paper-accent-hover"
              >
                {link.label}
              </button>
            ))}
          </span>
        )}
      </dd>
    </>
  );
}

export function AboutTab() {
  const [aboutStatus, setAboutStatus] = useState<string | null>(null);

  const handleOpenLink = async (url: string) => {
    try {
      await openExternalUrl(url);
      setAboutStatus(null);
    } catch {
      setAboutStatus('Не удалось открыть ссылку');
    }
  };

  const handleCopyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(
        formatDiagnostics(getRuntimeDiagnostics())
      );
      setAboutStatus('Сведения скопированы');
    } catch {
      setAboutStatus('Не удалось скопировать сведения');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
          О приложении
        </span>
        <div className="flex items-center gap-3 rounded border border-paper-border bg-paper-bg/50 p-3">
          <img
            src="/icon.svg"
            alt={`Логотип ${APP_INFO.name}`}
            className="h-12 w-12 shrink-0 rounded-[10px] border border-paper-border"
          />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-paper-ink">
              {APP_INFO.name}
            </div>
            <p className="mt-1 text-[12px] text-paper-muted">
              {APP_INFO.description}
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
          <AboutRow label="Версия" value={APP_INFO.version} />
          <AboutRow label="Сборка" value={APP_INFO.build} />
          <AboutRow label="Лицензия" value={APP_INFO.license} />
          <AboutRow label="Создатель" value={APP_INFO.creator} />
          <AboutRow
            label="Контакты"
            links={APP_INFO.contactsLinks}
            onOpenLink={(url) => void handleOpenLink(url)}
          />
          <AboutRow
            label="Документация"
            links={[{ label: 'README', url: APP_INFO.documentation }]}
            onOpenLink={(url) => void handleOpenLink(url)}
          />
          <AboutRow
            label="Репозиторий"
            links={[{ label: 'GitHub', url: APP_INFO.repository }]}
            onOpenLink={(url) => void handleOpenLink(url)}
          />
          <AboutRow
            label="Сообщить о проблеме"
            links={[{ label: 'Issues', url: APP_INFO.issues }]}
            onOpenLink={(url) => void handleOpenLink(url)}
          />
        </dl>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
          Сторонние компоненты
        </span>
        <p className="text-[12px] text-paper-ink">{APP_INFO.thirdParty}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
          Диагностика
        </span>
        <p className="text-[12px] text-paper-muted">
          Сведения о системе не содержат API-ключей, файлов проекта и изображений.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopyDiagnostics()}
            className="h-7 rounded border border-paper-border bg-paper-panel px-2.5 text-[12px] text-paper-ink hover:bg-paper-hover"
          >
            Скопировать сведения о системе
          </button>
          {aboutStatus && (
            <span className="text-[11px] text-paper-muted">
              {aboutStatus}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
