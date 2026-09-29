// Recipe-wise version of the multi-parameter trend logic.
// Drop these into the existing component in place of the old
// getMultiParameterTrendAnalysis / transformApiToChartData / prepareChartConfig.
//
// Imports to add at the top of the component file:
//
//   import {
//     ALL_RECIPES,
//     RecipeSegment,
//     buildRecipeSegments,
//     detectRecipeParamIds,
//     normaliseRows,
//     pointsInSegment,
//     recipeAt,
//     uniqueRecipes
//   } from "../utils/recipeTrend";
//
// State to add next to multiParameterData:
//
//   const [recipeParamId, setRecipeParamId] = useState<number | null>(null);
//   const [recipeSegments, setRecipeSegments] = useState<RecipeSegment[]>([]);
//   const [selectedRecipe, setSelectedRecipe] = useState<string>(ALL_RECIPES);

// Light fills for the recipe bands on the x-axis. Assigned in the order
// recipes first appear, so a recipe keeps its colour when others are filtered.
const recipeBandColors = [
  "rgba(235, 104, 52, 0.12)",
  "rgba(27, 175, 122, 0.12)",
  "rgba(42, 120, 214, 0.10)",
  "rgba(237, 161, 0, 0.14)",
  "rgba(232, 123, 164, 0.14)",
  "rgba(74, 58, 167, 0.10)"
];

const resetRecipeState = () => {
  setRecipeParamId(null);
  setRecipeSegments([]);
  setSelectedRecipe(ALL_RECIPES);
};

const getMultiParameterTrendAnalysis = async () => {
  if (!isMountedRef.current) return;

  // Check if we have required filter data - don't call API if filters not selected
  if (!filterData.selectedEquipment || !filterData.fromDate || !filterData.selectedShift) {
    setMultiParameterData([]);
    resetRecipeState();
    setLoading(false);
    return;
  }

  setMultiParameterData([]);
  resetRecipeState();
  setLoading(true);

  try {
    const parameterIds = flagData.viewDemo && (filterData.allSelectedParameters?.length === 0) ? [1384, 1385] : filterData.allSelectedParameters;

    const response = await getMultiParameterTrendAnalysisData(
      selectedPlantId.toString(),
      filterData.selectedEquipment.toString(),
      parameterIds,
      filterData.fromDate,
      filterData.selectedShift
    );

    if (isMountedRef.current) {
      if (response.statusCode === 200 && response.data) {
        if (!flagData.viewDemo) {
          setShowparameter(filterData.selectedParametersMulti);
        }

        // Sorted by time, one row per timestamp
        const rows = normaliseRows(response.data);

        // The recipe is the selected parameter with alphanumeric values (e.g. "CP500").
        // Every other selected parameter is plotted as a numeric trend.
        const recipeIds = detectRecipeParamIds(response.data, parameterIds);
        const recipeId = recipeIds.length ? recipeIds[0] : null;
        const numericIds = parameterIds.filter(id => !recipeIds.includes(id));

        setRecipeParamId(recipeId);
        setRecipeSegments(recipeId !== null ? buildRecipeSegments(rows, recipeId) : []);
        setMultiParameterData(transformApiToChartData(rows, numericIds));
      } else {
        setMultiParameterData([]);
      }
      setLoading(false);
    }
  } catch (error) {
    if (isMountedRef.current) {
      setMultiParameterData([]);
      resetRecipeState();
      setLoading(false);
      toast.error('Failed to load trend analysis data');
    }
  }
};

const getParameterName = (paramId: number) =>
  filterData.allParameters?.find(p => p.value === paramId)?.label ||
  filterData.selectedParametersMulti?.find(p => p.value === paramId)?.label ||
  `Parameter ${paramId}`;

const transformApiToChartData = (
  rows: { x: number; row: any }[],
  parameterIds: number[]
): ParameterData[] => {
  return parameterIds.map((paramId, index) => {
    const lineAlarms = alarmsEpochs[paramId] || [];

    const data = rows
      .filter(({ row }) => row[paramId] !== undefined && row[paramId] !== null && String(row[paramId]).trim() !== "")
      .map(({ x, row }) => {
        const y = Number(row[paramId]);
        const isAnomaly = lineAlarms.some(ts => Math.abs(x - ts) < 1000);

        return {
          x,
          y,
          marker: isAnomaly
            ? { enabled: true, symbol: "triangle", fillColor: "red", radius: 8 }
            : undefined
        };
      })
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

    return {
      parameterId: paramId,
      parameterName: getParameterName(paramId),
      color: colorPalette[index % colorPalette.length],
      data
    };
  });
};

const prepareChartConfig = () => {
  if (!multiParameterData.length) return null;

  const hasRecipes = recipeSegments.length > 0;
  const recipes = uniqueRecipes(recipeSegments);
  const recipeColor = (recipe: string) =>
    recipeBandColors[recipes.indexOf(recipe) % recipeBandColors.length];

  // Recipe runs in view: all of them, or only the selected recipe's runs
  const visibleSegments = selectedRecipe === ALL_RECIPES
    ? recipeSegments
    : recipeSegments.filter(s => s.recipe === selectedRecipe);

  const lastSegment = recipeSegments[recipeSegments.length - 1];
  const xMin = hasRecipes && selectedRecipe !== ALL_RECIPES ? Math.min(...visibleSegments.map(s => s.from)) : undefined;
  const xMax = hasRecipes && selectedRecipe !== ALL_RECIPES ? Math.max(...visibleSegments.map(s => s.to)) : undefined;

  // Shaded band + label for every recipe run
  const plotBands = visibleSegments.map(s => ({
    from: s.from,
    to: s.to,
    color: recipeColor(s.recipe),
    label: {
      text: s.recipe,
      align: "left",
      x: 6,
      y: 14,
      style: { fontSize: "11px", fontWeight: "600", color: "#4b545d" }
    }
  }));

  // Y-axes for each parameter
  const yAxes = multiParameterData.map((param, index) => ({
    title: { text: null },
    opposite: index % 2 === 1,
    labels: { style: { color: param.color } },
    gridLineWidth: index === 0 ? 1 : 0
  }));

  Highcharts.setOptions({ time: { useUTC: false } });

  const buildPoints = (points: ParameterData["data"], lineAlarms: number[]) =>
    points.map(point => {
      const x = point.x;
      const y = point.y;
      const isAlarm = lineAlarms.some(ts => Math.abs(ts - x) < 1000);
      return {
        x,
        y,
        enableMouseTracking: false,
        dataLabels: isAlarm
          ? {
              enabled: true,
              useHTML: true,
              format: `<span title="Alarm at ${Highcharts.dateFormat(
                "%Y-%m-%d %H:%M:%S",
                x
              )}">⚠️</span>`,
              align: "center",
              verticalAlign: "top",
              y: -10,
              style: { fontSize: "14px", color: "red" }
            }
          : undefined
      };
    });

  // Main parameter series.
  // With a recipe parameter, each parameter gets one series per recipe run so the
  // line breaks at every recipe change. The runs after the first are linkedTo the
  // first, so the legend still shows one entry per parameter.
  const parameterSeries: any[] = [];
  multiParameterData.forEach((paramData, idx) => {
    const lineAlarms = alarmsEpochs[paramData.parameterId] || [];
    const seriesId = `param-${paramData.parameterId}`;
    const name = flagData.viewDemo && (filterData.allSelectedParameters?.length === 0)
      ? ['Internal_Pressure_LEFT', "PCI_BOTTOM_CELL_PRESSURE_RIGHT"][idx]
      : paramData.parameterName;

    const runs = hasRecipes
      ? visibleSegments.map(s => ({
          recipe: s.recipe,
          points: pointsInSegment(paramData.data, s, s === lastSegment)
        }))
      : [{ recipe: null, points: paramData.data }];

    runs.forEach((run, runIdx) => {
      parameterSeries.push({
        id: runIdx === 0 ? seriesId : `${seriesId}-${runIdx}`,
        linkedTo: runIdx === 0 ? undefined : seriesId,
        name,
        color: paramData.color,
        yAxis: idx,
        parameterId: paramData.parameterId,
        recipe: run.recipe,
        turboThreshold: 150000,
        type: "line",
        marker: { enabled: false },
        data: buildPoints(run.points, lineAlarms)
      });
    });
  });

  // Upper / lower limit lines across the visible time range
  const limitSeries: any[] = [];
  multiParameterData.forEach((paramData, idx) => {
    const stats = stasticsAlarms.find(s => s.parameterId === paramData.parameterId);
    if (!stats || !paramData.data.length) return;

    const seriesId = `param-${paramData.parameterId}`;
    const from = xMin ?? paramData.data[0].x;
    const to = xMax ?? paramData.data[paramData.data.length - 1].x;

    [
      { label: "Upper Limit", value: stats.upperLimit },
      { label: "Lower Limit", value: stats.lowerLimit }
    ].forEach(limit => {
      if (limit.value === undefined) return;
      limitSeries.push({
        name: `${paramData.parameterName} ${limit.label}`,
        type: "line",
        color: paramData.color,
        dashStyle: "Dash",
        lineWidth: 1,
        yAxis: idx,
        linkedTo: seriesId,
        showInLegend: false,
        enableMouseTracking: false,
        marker: { enabled: false },
        data: [[from, limit.value], [to, limit.value]]
      });
    });
  });

  return {
    chart: {
      type: "line",
      height: 400,
      zoomType: "x",
      panning: true,
      panKey: "shift",
      backgroundColor: "#ffffff",
      borderRadius: 4
    },
    title: { text: null },
    xAxis: {
      type: "datetime",
      min: xMin,
      max: xMax,
      labels: { format: "{value:%H:%M:%S}" },
      gridLineWidth: 1,
      gridLineColor: "#e6e6e6",
      plotBands
    },
    yAxis: yAxes,
    legend: { enabled: true },
    plotOptions: {
      line: { animation: false, marker: { enabled: false, radius: 3 } },
      series: {
        turboThreshold: 150000,
        boostThreshold: 1
      }
    },
    boost: {
      useGPUTranslations: true,
      // Preallocated buffers only draw the first series when there are several
      // series per parameter (one per recipe run), so keep this off.
      usePreallocated: false,
      seriesThreshold: 1,
      enabled: true
    },
    series: [...parameterSeries, ...limitSeries],
    credits: { enabled: false },
    tooltip: {
      shared: true,
      crosshairs: true,
      formatter: function (this: Highcharts.TooltipFormatterContextObject) {
        const x = this.x as number;
        let tooltip = `<b>${Highcharts.dateFormat("%Y-%m-%d %H:%M:%S", x)}</b><br/>`;

        const recipe = recipeAt(recipeSegments, x);
        if (recipe) {
          tooltip += `Recipe: <b>${recipe}</b><br/>`;
        }

        this.points.forEach((point) => {
          const paramId = (point.series.userOptions as any).parameterId;
          const paramAlarms = alarmsEpochs[paramId] || [];

          tooltip += `<span style="color:${point.color}">●</span>
                      ${point.series.name}: <b>${point.y}</b>`;

          const alarmHit = paramAlarms.find(
            (ts) => Math.abs(ts - (point.x as number)) < 1000
          );

          if (alarmHit) {
            tooltip += ` (<span style="color:red">⚠️ Alarm at
                        ${Highcharts.dateFormat("%H:%M:%S", alarmHit)}</span>)<br/>`;
          } else {
            tooltip += `<br/>`;
          }
        });

        return tooltip;
      }
    }
  };
};

// Recipe filter to render above the chart. Picking a recipe shows only that
// recipe's runs; "All recipes" shows the whole shift with every recipe band.
//
//   {recipeSegments.length > 0 && (
//     <div className="recipe-filter">
//       <span>
//         Recipe{recipeParamId !== null ? ` (${getParameterName(recipeParamId)})` : ""}:
//       </span>
//       {[ALL_RECIPES, ...uniqueRecipes(recipeSegments)].map(recipe => (
//         <button
//           key={recipe}
//           className={recipe === selectedRecipe ? "active" : ""}
//           onClick={() => setSelectedRecipe(recipe)}
//         >
//           {recipe === ALL_RECIPES ? "All recipes" : recipe}
//         </button>
//       ))}
//     </div>
//   )}
