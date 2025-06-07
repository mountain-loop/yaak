import {
	useAtomValue
} from 'jotai';
import { graphqlSchemaAtom } from "../atoms/graphqlSchemaAtom";
import { Input } from "./core/Input";
import type {
	GraphQLSchema,
	GraphQLOutputType,
	GraphQLScalarType,
	GraphQLField,
	GraphQLList,
	GraphQLInputType,
	GraphQLNonNull,
	GraphQLObjectType
} from "graphql";
import { isNonNullType, isListType } from "graphql";
import { Button } from "./core/Button";
import { useEffect, useState } from 'react';
import { IconButton } from "./core/IconButton";
import { fuzzyFilter } from 'fuzzbunny';

function getRootTypes(graphqlSchema: GraphQLSchema) {
	return ([
		graphqlSchema.getQueryType(),
		graphqlSchema.getMutationType(),
		graphqlSchema.getSubscriptionType(),
	]
		.filter(Boolean) as NonNullable<ReturnType<GraphQLSchema['getQueryType']>>[])
		.reduce(
			(
				prev,
				curr
			) => {
				return {
					...prev,
					[curr.name]: curr,
				};
			},
			{} as Record<string, NonNullable<ReturnType<GraphQLSchema['getQueryType']>>>
		)
}

function getTypeIndices(
	type: GraphQLAnyType,
	context: IndexGenerationContext
): SearchIndexRecord[] {
	const indices: SearchIndexRecord[] = [];

	if (!(type as GraphQLObjectType).name) {
		return indices;
	}

	indices.push({
		name: (type as GraphQLObjectType).name,
		type: 'type',
		schemaPointer: type,
		args: ''
	});

	if ((type as GraphQLObjectType).getFields) {
		indices.push(
			...getFieldsIndices((type as GraphQLObjectType).getFields(), context)
		)
	}

	// remove duplicates from index
	return indices.filter(
		(x, i, array) => array.findIndex(
			(y) => y.name === x.name && y.type === x.type
		) === i
	);
}

function getFieldsIndices(
	fieldMap: FieldsMap,
	context: IndexGenerationContext
): SearchIndexRecord[] {
	const indices: SearchIndexRecord[] = [];

	Object.values(fieldMap)
		.forEach(
			(field) => {
				if (!field.name) {
					return;
				}

				const args = field.args && field.args.length > 0
					? field.args.map((arg) => arg.name).join(', ')
					: '';

				indices.push({
					name: field.name,
					type: context.rootType,
					schemaPointer: field as unknown as Field,
					args
				});

				if (field.type) {
					indices.push(
						...getTypeIndices(field.type, context)
					)
				}
			}
		);

	// remove duplicates from index
	return indices.filter(
		(x, i, array) => array.findIndex(
			(y) => y.name === x.name && y.type === x.type
		) === i
	);
}

type Field = NonNullable<ReturnType<GraphQLSchema['getQueryType']>>;
type FieldsMap = ReturnType<Field['getFields']>;
type GraphQLAnyType = FieldsMap[string]['type'];

type SearchIndexRecord = {
	name: string,
	args: string,
	type: 'field' | 'type' | 'Query' | 'Mutation' | 'Subscription',
	schemaPointer: SchemaPointer
};

type IndexGenerationContext = {
	rootType: 'Query' | 'Mutation' | 'Subscription';
};

type SchemaPointer = Field | GraphQLOutputType | GraphQLInputType | null;

type ViewMode = 'explorer' | 'search' | 'field';

type HistoryRecord = {
	schemaPointer: SchemaPointer,
	viewMode: ViewMode
};

function DocsExplorer({
						  graphqlSchema
					  }: { graphqlSchema: GraphQLSchema }) {
	const [rootTypes, setRootTypes] = useState(getRootTypes(graphqlSchema));
	const [schemaPointer, setSchemaPointer] = useState<SchemaPointer>(null);
	const [history, setHistory] = useState<HistoryRecord[]>([]);
	const [searchIndex, setSearchIndex] = useState<SearchIndexRecord[]>([]);
	const [searchQuery, setSearchQuery] = useState<string>('');
	const [searchResults, setSearchResults] = useState<SearchIndexRecord[]>([]);
	const [viewMode, setViewMode] = useState<ViewMode>('explorer');

	useEffect(() => {
		setRootTypes(getRootTypes(graphqlSchema));
	}, [graphqlSchema]);

	useEffect(() => {
		const typeMap = graphqlSchema.getTypeMap();

		const index: SearchIndexRecord[] = Object.values(typeMap)
			.filter(
				(x) => !x.name.startsWith('__')
			)
			.map(
				(x) => ({
					name: x.name,
					type: 'type',
					schemaPointer: x,
					args: ''
				})
			);

		Object.values(rootTypes)
			.forEach(
				(type) => {
					index.push(
						...getFieldsIndices(type.getFields(), { rootType: type.name as any })
					)
				}
			)

		setSearchIndex(
			index
				.filter(
					(x, i, array) => array.findIndex(
						(y) => y.name === x.name && y.type === x.type
					) === i
				)
		);
	}, [graphqlSchema, rootTypes]);

	useEffect(
		() => {
			if (!searchQuery) {
				setSearchResults([]);
				return;
			}

			const results = fuzzyFilter(
				searchIndex,
				searchQuery,
				{ fields: ['name', 'args'] }
			)
				.sort((a, b) => b.score - a.score)
				.map((v) => v.item);

			setSearchResults(results);
		},
		[searchIndex, searchQuery]
	);

	const goBack = () => {
		if (history.length === 0) {
			return;
		}

		const newHistory = history.slice(0, history.length - 1);

		const prevHistoryRecord = newHistory[newHistory.length - 1];

		if (prevHistoryRecord) {
			const { schemaPointer: newPointer, viewMode } = prevHistoryRecord;
			setHistory(newHistory);
			setSchemaPointer(newPointer!);
			setViewMode(viewMode);

			return;
		}

		goHome();
	}

	const addToHistory = (historyRecord: HistoryRecord) => {
		setHistory([...history, historyRecord]);
	}

	const goHome = () => {
		setHistory([]);
		setSchemaPointer(null);
		setViewMode('explorer');
	}

	const renderRootTypes = () => {
		return (
			<div
				className="mt-5 flex flex-col gap-3"
			>
				{
					Object
						.values(rootTypes)
						.map(
							(x) => (
								<button
									key={ x.name }
									className="block text-primary cursor-pointer w-fit"
									onClick={
										() => {
											addToHistory({
												schemaPointer: x,
												viewMode: 'explorer',
											});
											setSchemaPointer(x);
										}
									}
								>
									{ x.name }
								</button>
							)
						)
				}
			</div>
		);
	}

	const extractActualType = (
		type: GraphQLField<never, never>['type'] | GraphQLInputType
	) => {
		// check if non-null
		if (isNonNullType(type) || isListType(type)) {
			return extractActualType((type as GraphQLNonNull<GraphQLOutputType>).ofType)
		}

		return type;
	}

	const onTypeClick = (
		type: GraphQLField<never, never>['type'] | GraphQLInputType
	) => {
		// check if non-null
		if (isNonNullType(type)) {
			onTypeClick((type as GraphQLNonNull<GraphQLOutputType>).ofType)

			return;
		}

		// check if list
		if (isListType(type)) {
			onTypeClick((type as GraphQLList<GraphQLOutputType>).ofType);

			return;
		}

		setSchemaPointer(type);
		addToHistory({
			schemaPointer: type as Field,
			viewMode: 'explorer',
		});
		setViewMode('explorer');
	};

	const onFieldClick = (field: GraphQLField<any, any>) => {
		setSchemaPointer(field as unknown as Field);
		setViewMode('field');
		addToHistory({
			schemaPointer: field as unknown as Field,
			viewMode: 'field',
		});
	};

	const renderSubFieldRecord = (
		field: FieldsMap[string],
		options?: {
			addable?: boolean,
		}
	) => {
		return (
			<div
				className="flex flex-row justify-start items-center"
			>
				{
					options?.addable
						? (
							<IconButton size="sm" icon="plus_circle" iconColor="secondary" title="Add to query"/>
						)
						: null
				}
				<div
					className="flex flex-col"
				>
					<div>
						<span>
							{ " " }
						</span>
						<button
							className="cursor-pointer text-primary"
							onClick={ () => onFieldClick(field) }
						>
							{ field.name }
						</button>
						{/* Arguments block */ }
						{
							field.args && field.args.length > 0
								? (
									<>
								<span>
									{ " " }
									(
									{ " " }
								</span>
										{
											field.args.map(
												(arg, i, array) => (
													<>
														<button
															key={ arg.name }
															onClick={ () => onTypeClick(arg.type) }
														>
															<span
																className="text-primary cursor-pointer"
															>
																{ arg.name }
															</span>
																	<span>{ " " }</span>
																	<span
																		className="text-success underline cursor-pointer"
																	>{ arg.type.toString() }</span>
																	{
																		i < array.length - 1
																			? (
																				<>
																					<span>{ " " }</span>
																					<span> , </span>
																					<span>{ " " }</span>
																				</>
																			)
																			: null
																	}
														</button>
														<span>{ " " }</span>
													</>
												)
											)
										}
										<span>
									)
								</span>
									</>
								)
								: null
						}
						{/* End of Arguments Block */ }
						<span>{ " " }</span>
						<button
							className="text-success underline cursor-pointer"
							onClick={ () => onTypeClick(field.type) }
						>
							{ field.type.toString() }
						</button>
					</div>
					{
						field.description
							? (
								<div>
									{ field.description }
								</div>
							)
							: null
					}
				</div>
			</div>
		);
	};

	const renderScalarField = () => {
		const scalarField = schemaPointer as GraphQLScalarType;

		return (
			<div>
				{ scalarField.toConfig().description }
			</div>
		);
	};

	const renderSubFields = () => {
		if (!schemaPointer) {
			return null;
		}

		if (
			!(schemaPointer as Field).getFields
		) {
			// Scalar field
			return renderScalarField();
		}

		if (!(schemaPointer as Field).getFields()) {
			return null;
		}

		return Object.values((schemaPointer as Field).getFields())
			.map(
				(x) => renderSubFieldRecord(x, { addable: true })
			)
	};

	const renderFieldDocView = () => {
		if (!schemaPointer) {
			return null;
		}

		return (
			<div>
				<div
					className="text-primary mt-5"
				>
					{ (schemaPointer as Field).name }
				</div>
				{
					(schemaPointer as Field).getFields
						? (
							<div
								className="my-3"
							>
								Fields
							</div>
						)
						: null
				}
				<div
					className="flex flex-col gap-7"
				>
					{ renderSubFields() }
				</div>
			</div>
		)
	}

	const renderExplorerView = () => {
		if (history.length === 0) {
			return renderRootTypes();
		}

		return renderFieldDocView()
	};

	const renderFieldView = () => {
		if (!schemaPointer) {
			return null;
		}

		const field = schemaPointer as GraphQLField<any, any>;
		const returnType = extractActualType(field.type);

		return (
			<div>
				<div
					className="text-primary mt-10"
				>
					{ field.name }
				</div>
				{/*  Arguments */}
				{
					field.args && field.args.length > 0
						? (
							<div
								className="mt-8"
							>
								<div>
									Arguments
								</div>
								<div
									className="mt-2"
								>
									<div>
										{
											field.args.map(
												(arg, i, array) => (
													<>
														<button
															key={ arg.name }
															onClick={ () => onTypeClick(arg.type) }
														>
															<span
																className="text-primary cursor-pointer"
															>
																{ arg.name }
															</span>
															<span>{ " " }</span>
															<span
																className="text-success underline cursor-pointer"
															>{ arg.type.toString() }</span>
															{
																i < array.length - 1
																	? (
																		<>
																			<span>{ " " }</span>
																			<span> , </span>
																			<span>{ " " }</span>
																		</>
																	)
																	: null
															}
														</button>
														<span>{ " " }</span>
													</>
												)
											)
										}
									</div>
								</div>
							</div>
						)
						: null
				}
				{/* End of Arguments */}
				{/* Return type	*/}
				<div
					className="mt-8"
				>
					<div>
						Type
					</div>
					<div
						className="text-primary mt-2"
					>
						{ returnType.name }
					</div>
				</div>
				{/* End of Return type	*/}
				{/* Fields */}
				{
					(returnType as GraphQLObjectType).getFields && Object.values((returnType as GraphQLObjectType).getFields()).length > 0
						? (
							<div
								className="mt-8"
							>
								<div>
									Fields
								</div>
								<div
									className="flex flex-col gap-3 mt-2"
								>
									{
										Object.values((returnType as GraphQLObjectType).getFields())
											.map(
												(x) => renderSubFieldRecord(x)
											)
									}
								</div>
							</div>
						)
						: null
				}
				{/* End of Fields */}
			</div>
		);
	};

	const renderTopBar = () => {
		return (
			<div
				className="flex flex-row gap-2"
			>
				<Button
					onClick={ goBack }
				>
					Back
				</Button>
				<IconButton
					onClick={ goHome }
					icon="house"
					title="Go to beginning"
				/>
			</div>
		);
	};

	const renderSearchView = () => {
		return (
			<div>
				<div
					className="mt-5 text-primary"
				>
					Search results
				</div>
				<div
					className="mt-4 flex flex-col gap-3"
				>
					{
						searchResults
							.map(
								(result) => (
									<button
										key={`${result.name}-${result.type}`}
										className="cursor-pointer border border-1 border-border-subtle rounded-md p-2 flex flex-row justify-between hover:bg-surface-highlight transition-colors"
										onClick={
											() => {
												if (!result.schemaPointer) {
													throw new Error('somehow search result record contains no schema pointer');
												}

												console.log(result);

												if (result.type === 'type') {
													onTypeClick(result.schemaPointer);

													return;
												}

												onFieldClick(result.schemaPointer as unknown as GraphQLField<any, any>);
											}
										}
									>
										<div
											className="flex flex-row"
										>
											<div
												className="cursor-pointer"
											>
												{ result.name }
											</div>
											{
												result.args
													? (
														<div
															className="cursor-pointer"
														>
															{ "( " }
															{ result.args }
															{ " )" }
														</div>
													)
													: null
											}
										</div>
										<div
											className="cursor-pointer"
										>
											{ result.type }
										</div>
									</button>
								)
							)
					}
				</div>
			</div>
		);
	};

	const renderView = () => {
		if (viewMode === 'field') {
			return renderFieldView();
		}

		if (viewMode === 'search') {
			return renderSearchView();
		}

		return renderExplorerView();
	};

	return (
		<div
			className="overflow-y-auto pe-3"
		>
			<div
				className="min-h-[35px]"
			>
				{
					history.length > 0 || viewMode === 'search'
						? renderTopBar()
						: null
				}
			</div>
			{/* Search bar */}
			<div
				className="relative"
			>
				<Input
					label="Search docs"
					stateKey="search_graphql_docs"
					placeholder="Search docs"
					hideLabel
					defaultValue={searchQuery}
					onChange={
						(value) => {
							setSearchQuery(value);
						}
					}
					onKeyDown={
						(e) => {
							// check if enter
							if (e.key === 'Enter' && viewMode !== 'search') {
								addToHistory({
									schemaPointer: null,
									viewMode: 'search',
								})
								setViewMode('search');
							}
						}
					}
				/>
			</div>
			{/* End of search bar */}
			<div>
				{ renderView() }
			</div>
		</div>
	);
}

export function GraphQLDocsExplorer() {
	const graphqlSchema = useAtomValue(graphqlSchemaAtom);

	if (graphqlSchema) {
		return <DocsExplorer graphqlSchema={ graphqlSchema }/>;
	}

	return <div>There is no schema</div>;
}
