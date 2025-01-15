import { save } from '@tauri-apps/plugin-dialog';
import type { HttpResponse } from '@yaakapp-internal/models';
import mime from 'mime';
import slugify from 'slugify';
import { InlineCode } from '../components/core/InlineCode';
import { getContentTypeHeader } from '../lib/model_util';
import { getHttpRequest } from '../lib/store';
import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';
import { showToast } from '../lib/toast';

export function useSaveResponse(response: HttpResponse) {
  return useFastMutation({
    mutationKey: ['save_response', response.id],
    mutationFn: async () => {
      const request = await getHttpRequest(response.requestId);
      if (request == null) return null;

      const contentType = getContentTypeHeader(response.headers) ?? 'unknown';
      const ext = mime.getExtension(contentType);
      const slug = slugify(request.name || 'response', { lower: true });
      const filepath = await save({
        defaultPath: ext ? `${slug}.${ext}` : slug,
        title: 'Save Response',
      });
      await invokeCmd('cmd_save_response', { responseId: response.id, filepath });
      showToast({
        message: (
          <>
            Response saved to <InlineCode>{filepath}</InlineCode>
          </>
        ),
      });
    },
  });
}
