import * as vscode from 'vscode';
import * as z from 'zod';
import { callProcedure } from './utils';
import { sortBy } from 'es-toolkit';
import { getLogger } from '@helloao/tools/log.js';

export const COMMENT_SCHEMA = z.object({
  type: z.literal('comment'),
  html: z.string(),
  replyTo: z.nullable(z.optional(z.string())),

  // The Time in miliseconds that the comment was created
  createdAtMs: z.nullable(z.optional(z.number())),

  // The Time in miliseconds that the comment was last updated
  updatedAtMs: z.nullable(z.optional(z.number())),
});

export const ANNOTATION_DATA_SCHEMA = z.discriminatedUnion('type', [
  COMMENT_SCHEMA,
]);

export const ANNOTATION_SCHEMA = z.object({
  id: z.string(),
  bookId: z.string(),
  chapterNumber: z.number(),
  verseNumber: z.nullable(z.optional(z.number())),
  endVerseNumber: z.nullable(z.optional(z.number())),
  data: ANNOTATION_DATA_SCHEMA,
  order: z.nullable(z.optional(z.number())),
});

export const ANNOTATION_ARRAY_SCHEMA = z.array(ANNOTATION_SCHEMA);

export type Annotation = z.infer<typeof ANNOTATION_SCHEMA>;
export type AnnotationData = z.infer<typeof ANNOTATION_DATA_SCHEMA>;
export type CommentData = z.infer<typeof COMMENT_SCHEMA>;

export function getAnnotationMarker(
  bookId: string,
  chapterNumber: number,
  group: string = 'annotations'
): string {
  return `publicRead:${group}/${bookId}/${chapterNumber}`;
}

/**
 * Gets the annotations for the given book and chapter.
 * @param context The extension context.
 * @param recordNameOrKey The name of the record to load annotations from.
 * @param bookId The ID of the book.
 * @param chapterNumber The number of the chapter.
 * @param group The group of annotations to load.
 */
export async function loadAnnotations(
  context: vscode.ExtensionContext,
  recordNameOrKey: string,
  bookId: string,
  chapterNumber: number,
  group?: string
): Promise<Annotation[]> {
  const l = getLogger();
  l.log('Loading annotations with params: ', {
    recordNameOrKey,
    bookId,
    chapterNumber,
    group,
  });

  const marker = getAnnotationMarker(bookId, chapterNumber, group);

  const annotations: Annotation[] = [];
  let lastAddress: string | undefined = undefined;
  while (true) {
    const data = await callProcedure<'listData'>(context, 'listData', {
      recordName: recordNameOrKey,
      marker,
      address: lastAddress,
    });

    if (data.success === false) {
      l.error('Error loading annotations: ', data);
      throw new Error('Error loading annotations');
    }

    const items = data.items;
    if (items.length === 0) {
      l.log('No more annotations to load.');
      break;
    }

    for (let item of items) {
      const parsed = ANNOTATION_SCHEMA.safeParse(item.data);
      if (!parsed.success) {
        l.warn('Failed to parse annotation: ', item.data, parsed.error);
      } else {
        annotations.push(parsed.data);
      }
    }
    lastAddress = items[items.length - 1].address as string;
  }

  l.log(
    `Loaded ${annotations.length} annotations for ${bookId} ${chapterNumber}.`
  );
  return sortBy(annotations, [
    'bookId',
    'chapterNumber',
    'verseNumber',
    'endVerseNumber',
    'order',
  ]);
}
