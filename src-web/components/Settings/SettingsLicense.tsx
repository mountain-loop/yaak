import { openUrl } from "@tauri-apps/plugin-opener";
import { useLicense } from "@yaakapp-internal/license";
import { differenceInDays } from "date-fns";
import { formatDate } from "date-fns/format";
import { useState } from "react";
import { useToggle } from "../../hooks/useToggle";
import { pluralizeCount } from "../../lib/pluralize";
import { CargoFeature } from "../CargoFeature";
import { Banner } from "../core/Banner";
import { Button } from "../core/Button";
import { Icon } from "../core/Icon";
import { Link } from "../core/Link";
import { PlainInput } from "../core/PlainInput";
import { Separator } from "../core/Separator";
import { HStack, VStack } from "../core/Stacks";

export function SettingsLicense() {
  return (
    <CargoFeature feature="license">
      <SettingsLicenseCmp />
    </CargoFeature>
  );
}

function SettingsLicenseCmp() {
  const { check, activate, deactivate } = useLicense();
  const [key, setKey] = useState<string>("");
  const [activateFormVisible, toggleActivateFormVisible] = useToggle(false);

  if (check.isPending) {
    return null;
  }

  const renderBanner = () => {
    if (!check.data) return null;

    switch (check.data.status) {
      case "active":
        return <Banner color="success">Ваша лицензия активна 🥳</Banner>;

      case "trialing":
        return (
          <Banner color="info" className="max-w-lg">
            <p className="w-full">
              <strong>
                {pluralizeCount("day", differenceInDays(check.data.data.end, new Date()))}
              </strong>{" "}
              осталось для оценки Yaak в коммерческом использовании.
              <br />
              <span className="opacity-50">Личное использование всегда бесплатно.</span>
              <Separator className="my-2" />
              <div className="flex flex-wrap items-center gap-x-2 text-sm text-notice">
                <Link noUnderline href={`https://yaak.app/pricing?s=learn&t=${check.data.status}`}>
                  Подробнее
                </Link>
              </div>
            </p>
          </Banner>
        );

      case "personal_use":
        return (
          <Banner color="notice" className="max-w-lg">
            <p className="w-full">
              Ваш пробный период для коммерческого использования завершён.
              <br />
              <span className="opacity-50">
                Вы можете продолжать использовать Yaak только для личных целей.
                <br />Для коммерческого использования требуется лицензия.
              </span>
              <Separator className="my-2" />
              <div className="flex flex-wrap items-center gap-x-2 text-sm text-notice">
                <Link noUnderline href={`https://yaak.app/pricing?s=learn&t=${check.data.status}`}>
                  Подробнее
                </Link>
              </div>
            </p>
          </Banner>
        );

      case "inactive":
        return (
          <Banner color="danger">
            Ваша лицензия недействительна. Пожалуйста, <Link href="https://yaak.app/dashboard">войдите</Link>{" "}
            для подробностей
          </Banner>
        );

      case "expired":
        return (
          <Banner color="notice">
            Срок действия вашей лицензии истёк{" "}
            <strong>{formatDate(check.data.data.periodEnd, "MMMM dd, yyyy")}</strong>. Please{" "}
            <Link href="https://yaak.app/dashboard">Продлите подписку</Link> to continue receiving
            updates.
            {check.data.data.changesUrl && (
              <>
                <br />
                <Link href={check.data.data.changesUrl}>Что нового в последних сборках</Link>
              </>
            )}
          </Banner>
        );

      case "past_due":
        return (
          <Banner color="danger">
            <strong>Ваш способ оплаты требует внимания.</strong>
            <br />
            To re-activate your license, please{" "}
            <Link href={check.data.data.billingUrl}>обновите платёжные данные</Link>.
          </Banner>
        );

      case "error":
        return (
          <Banner color="danger">
            Проверка лицензии не удалась: {check.data.data.message} (Код: {check.data.data.code})
          </Banner>
        );
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      {renderBanner()}

      {check.error && <Banner color="danger">{check.error}</Banner>}
      {activate.error && <Banner color="danger">{activate.error}</Banner>}

      {check.data?.status === "active" ? (
        <HStack space={2}>
          <Button variant="border" color="secondary" size="sm" onClick={() => deactivate.mutate()}>
            Деактивировать лицензию
          </Button>
          <Button
            color="secondary"
            size="sm"
            onClick={() => openUrl("https://yaak.app/dashboard?s=support&ref=app.yaak.desktop")}
            rightSlot={<Icon icon="external_link" />}
          >
            Прямая поддержка
          </Button>
        </HStack>
      ) : (
        <HStack space={2}>
          <Button variant="border" color="secondary" size="sm" onClick={toggleActivateFormVisible}>
            Активировать лицензию
          </Button>
          <Button
            size="sm"
            color="primary"
            rightSlot={<Icon icon="external_link" />}
            onClick={() =>
              openUrl(
                `https://yaak.app/pricing?s=purchase&ref=app.yaak.desktop&t=${check.data?.status ?? ""}`,
              )
            }
          >
            Купить лицензию
          </Button>
        </HStack>
      )}

      {activateFormVisible && (
        <VStack
          as="form"
          space={3}
          className="max-w-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            await activate.mutateAsync({ licenseKey: key });
            toggleActivateFormVisible();
          }}
        >
          <PlainInput
            autoFocus
            label="Лицензионный ключ"
            name="key"
            onChange={setKey}
            placeholder="YK1-XXXXX-XXXXX-XXXXX-XXXXX"
          />
          <Button type="submit" color="primary" size="sm" isLoading={activate.isPending}>
            Отправить
          </Button>
        </VStack>
      )}
    </div>
  );
}
