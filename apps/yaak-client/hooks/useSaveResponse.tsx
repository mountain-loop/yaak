import { save } from '@tauri-apps/plugin-dialog';
import type { HttpResponse } from '@yaakapp-internal/models';
import { getModel } from '@yaakapp-internal/models';
import mime from 'mime';
import slugify from 'slugify';
import { InlineCode } from '../components/core/InlineCode';
import { getContentTypeFromHeaders } from '../lib/model_util';
import { invokeCmd } from '../lib/tauri';
import { showToast } from '../lib/toast';
import { useFastMutation } from './useFastMutation';

export function useSaveResponse(response: HttpResponse) {
  return useFastMutation({
    mutationKey: ['save_response', response.id],
    mutationFn: async () => {
      const request = getModel('http_request', response.requestId);
      if (request == null) return null;

      const contentType = getContentTypeFromHeaders(response.headers) ?? 'unknown';
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
