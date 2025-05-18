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

function getTypeIndices(type: GraphQLAnyType): SearchIndexRecord[] {
	const indices: SearchIndexRecord[] = [];

	if (!(type as GraphQLObjectType).name) {
		return indices;
	}

	indices.push({
		name: (type as GraphQLObjectType).name,
		type: 'type',
	});

	if ((type as GraphQLObjectType).getFields) {
		indices.push(
			...getFieldsIndices((type as GraphQLObjectType).getFields())
		)
	}

	// remove duplicates from index
	return indices.filter(
		(x, i, array) => array.findIndex(
			(y) => y.name === x.name
		) === i
	);
}

function getFieldsIndices(fieldMap: FieldsMap): SearchIndexRecord[] {
	const indices: SearchIndexRecord[] = [];

	Object.values(fieldMap)
		.forEach(
			(field) => {
				if (!field.name) {
					return;
				}

				indices.push({
					name: field.name,
					type: 'field',
				});

				if (field.type) {
					indices.push(
						...getTypeIndices(field.type)
					)
				}
			}
		);

	// remove duplicates from index
	return indices.filter(
		(x, i, array) => array.findIndex(
			(y) => y.name === x.name
		) === i
	);
}

type Field = NonNullable<ReturnType<GraphQLSchema['getQueryType']>>;
type FieldsMap = ReturnType<Field['getFields']>;
type GraphQLAnyType = FieldsMap[string]['type'];

type SearchIndexRecord = {
	name: string,
	type: 'field' | 'type' | 'query' | 'mutation' | 'subscription',
};

type SchemaPointer = Field | GraphQLOutputType | GraphQLInputType | null;

function DocsExplorer({
						  graphqlSchema
					  }: { graphqlSchema: GraphQLSchema }) {
	const [rootTypes, setRootTypes] = useState(getRootTypes(graphqlSchema));
	const [schemaPointer, setSchemaPointer] = useState<SchemaPointer>(null);
	const [history, setHistory] = useState<(Field | GraphQLInputType)[]>([]);
	const [searchIndex, setSearchIndex] = useState<SearchIndexRecord[]>([]);
	const [searchQuery, setSearchQuery] = useState<string>('');
	const [searchResults, setSearchResults] = useState<SearchIndexRecord[]>([]);
	const [viewMode, setViewMode] = useState<'explorer' | 'search' | 'field'>('explorer');

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
				})
			);

		Object.values(rootTypes)
			.forEach(
				(type) => {
					index.push(
						...getFieldsIndices(type.getFields())
					)
				}
			)

		setSearchIndex(
			index
				.filter(
					(x, i, array) => array.findIndex(
						(y) => y.name === x.name
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
				{ fields: ['name'] }
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
		const newPointer = newHistory[newHistory.length - 1];
		setHistory(newHistory);
		setSchemaPointer(newPointer!);
	}

	const addToHistory = (pointer: Field | GraphQLInputType) => {
		setHistory([...history, pointer]);
	}

	const goHome = () => {
		setHistory([]);
		setSchemaPointer(null);
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
											addToHistory(x);
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

	const onTypeClick = (
		type: GraphQLField<never, never>['type'] | GraphQLInputType
	) => {
		console.log(type);
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
		addToHistory(type as Field);
	};

	const onFieldClick = (field: GraphQLField<any, any>) => {
		
	};

	const renderSubFieldRecord = (
		field: FieldsMap[string]
	) => {
		return (
			<div
				className="flex flex-row justify-start items-center"
			>
				<IconButton size="sm" icon="plus_circle" iconColor="secondary" title="Add to query"/>
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
				(x) => renderSubFieldRecord(x)
			)
	};

	const renderFieldDocView = () => {
		if (!schemaPointer) {
			return null;
		}

		return (
			<div>
				<div
					className="text-primary mt-4"
				>
					{ (schemaPointer as Field).name }
				</div>
				<div
					className="my-3"
				>
					Fields
				</div>
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

	return (
		<div
			className="overflow-y-auto"
		>
			<div
				className="min-h-8"
			>
				{
					history.length > 0
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
					onChange={
						(value) => {
							setSearchQuery(value);
						}
					}
				/>
				{
					searchResults.length > 0
						? (
							<div
								className="flex flex-col gap-2 absolute top-[45px] w-full rounded-md bg-surface-highlight py-3"
							>
								{
									searchResults
										// get first 8 items
										.slice(0, 8)
										.map(
											(x) => (
												<button
													key={ x.name }
													onClick={ () => {
														const type = graphqlSchema.getType(x.name);
														if (type) {
															setSchemaPointer(type);
														}
													} }
													className="flex flex-row justify-between cursor-pointer border border-border-subtle enabled:hocus:border-border rounded mx-2 py-1"
												>
													<div>
														{ x.name }
													</div>
													<div>
														{ x.type }
													</div>
												</button>
										)
									)
								}
							</div>
						)
						: null
				}
			</div>
			{/* End of search bar */}
			<div>
				{ renderExplorerView() }
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
