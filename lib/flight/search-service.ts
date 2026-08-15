import { addDays, format, parseISO } from 'date-fns';
import { 
  Flight, 
  Route, 
  SearchParams, 
  InternalSegment, 
  SearchNode,
  CONSTRAINTS
} from './types';
import { flightDataService } from './data-service';
import { 
  getDayOfWeek, 
  isInTimeWindow, 
  formatAbsoluteTime,
  formatArrivalTime,
  isProductAvailable,
} from './utils';
import {
  FLIGHT_DATA_PERIOD_LABEL,
  RESTRICTED_PERIODS_666,
  isWithinFlightDataPeriod,
} from './data-period';

class FlightSearchService {
  // 检查666版本的日期限制
  private isDateRestricted(date: string, version: '666' | '2666' = '666'): boolean {
    if (version !== '666') {
      return false; // 2666版本不受限制
    }

    return RESTRICTED_PERIODS_666.some(
      (period) => date >= period.start && date <= period.end
    );
  }

  private isFlightAvailableOnDate(flight: Flight, date: string): boolean {
    if (flight.operating_dates?.length) {
      return flight.operating_dates.includes(date);
    }
    if (flight.valid_from && date < flight.valid_from) return false;
    if (flight.valid_to && date > flight.valid_to) return false;
    return true;
  }
  // BFS搜索航班路线
  searchFlights(params: SearchParams): { routes: Route[], restriction?: string } {
    const { origin_city, dest_city, date, windows, max_stops, version = '666' } = params;

    if (!isWithinFlightDataPeriod(date)) {
      return {
        routes: [],
        restriction: `当前航班快照仅覆盖${FLIGHT_DATA_PERIOD_LABEL}`,
      };
    }
    
    // 检查666版本的日期限制（五一4.30-5.6、国庆9.30-10.9）
    if (this.isDateRestricted(date, version)) {
      console.log('666版本在节假日限制期间无法预订');
      return {
        routes: [],
        restriction: `666版本在${RESTRICTED_PERIODS_666[0].label}不可用`
      };
    }
    
    // 获取查询日的星期几
    const baseDow = getDayOfWeek(date);
    
    // 初始化搜索队列
    const queue: SearchNode[] = [];
    const routes: Route[] = [];
    // 移除剪枝，不再记录最佳到达时间
    
    // 转换星期格式：getDayOfWeek返回0-6（0=周日），需要转换为1-7（1=周一，7=周日）
    const firstDayOfWeek = baseDow === 0 ? 7 : baseDow;
    
    // 获取首段航班（必须在时间窗口内）
    const firstDayFlights = flightDataService.getFlightsByOriginAndDay(origin_city, firstDayOfWeek);
    
    for (const flight of firstDayFlights) {
      if (!this.isFlightAvailableOnDate(flight, date) || !isProductAvailable(flight.product, version)) {
        continue;
      }

      // 检查是否在时间窗口内
      if (!isInTimeWindow(flight.dep_minutes, windows, version)) {
        continue;
      }
      
      // 创建首段
      const segment: InternalSegment = {
        flight,
        dep_abs: flight.dep_minutes,
        arr_abs: flight.arr_minutes + (flight.overnight ? 1440 : 0),
        plus_day: 0
      };
      
      // 如果直飞到达目的地
      if (flight.dest_city === dest_city) {
        const route = this.createRoute([segment], date);
        routes.push(route);
        // 不再更新最佳到达时间
      } else if (max_stops > 0) {
        // 加入搜索队列
        queue.push({
          segments: [segment],
          visited_cities: new Set([origin_city, flight.dest_city]),
          arr_abs: segment.arr_abs,
          total_duration: segment.arr_abs - segment.dep_abs
        });
      }
    }
    
    // BFS搜索
    while (queue.length > 0) {
      const node = queue.shift()!;
      
      // 检查是否已达到最大中转次数
      if (node.segments.length >= max_stops + 1) {
        continue;
      }
      
      const lastSegment = node.segments[node.segments.length - 1];
      const currentCity = lastSegment.flight.dest_city;
      
      // 计算下一段的起飞日
      const arrivalDayOffset = Math.floor(lastSegment.arr_abs / 1440);
      
      // 获取当前到达城市的航班，需要考虑当天和次日的航班
      const flightsToCheck: Array<{flight: Flight, dayOffset: number}> = [];
      
      // 检查同一天的航班（如果到达时间较早）
      if (arrivalDayOffset <= CONSTRAINTS.MAX_TRIP_SPAN_DAYS) {
        const sameDayDowRaw = (baseDow + arrivalDayOffset) % 7;
        const sameDayDow = sameDayDowRaw === 0 ? 7 : sameDayDowRaw;
        const sameDayFlights = flightDataService.getFlightsByOriginAndDay(currentCity, sameDayDow);
        sameDayFlights.forEach(f => flightsToCheck.push({flight: f, dayOffset: arrivalDayOffset}));
      }
      
      // 检查次日的航班（对于深夜到达的情况）
      const nextDayOffset = arrivalDayOffset + 1;
      if (nextDayOffset <= CONSTRAINTS.MAX_TRIP_SPAN_DAYS) {
        const nextDayDowRaw = (baseDow + nextDayOffset) % 7;
        const nextDayDow = nextDayDowRaw === 0 ? 7 : nextDayDowRaw;
        const nextDayFlights = flightDataService.getFlightsByOriginAndDay(currentCity, nextDayDow);
        nextDayFlights.forEach(f => flightsToCheck.push({flight: f, dayOffset: nextDayOffset}));
      }
      
      // 限制每个节点的扩展数量
      let expandCount = 0;
      
      for (const {flight, dayOffset} of flightsToCheck) {
        if (expandCount >= CONSTRAINTS.MAX_EXPAND_PER_NODE) break;

        const segmentDateStr = format(addDays(parseISO(date), dayOffset), 'yyyy-MM-dd');
        if (
          !isWithinFlightDataPeriod(segmentDateStr) ||
          !this.isFlightAvailableOnDate(flight, segmentDateStr) ||
          !isProductAvailable(flight.product, version)
        ) {
          continue;
        }
        
        // 检查是否访问过该城市（避免回环）
        if (node.visited_cities.has(flight.dest_city)) {
          continue;
        }
        
        // 中转航班需要检查版本限制，但不受用户选择的时间窗口（早/晚）限制
        // 666版本：所有航班必须在20:00-23:59或00:00-08:59
        // 2666版本：所有航班必须在19:00-23:59或00:00-09:59
        if (version === '666') {
          // 对于666版本，中转航班也必须在版本允许的时间范围内
          // 但不需要考虑用户选择的windows（早/晚），所以传入both
          if (!isInTimeWindow(flight.dep_minutes, ['early', 'late'], version)) {
            continue;
          }
        } else if (version === '2666') {
          // 对于2666版本，中转航班也必须在版本允许的时间范围内
          if (!isInTimeWindow(flight.dep_minutes, ['early', 'late'], version)) {
            continue;
          }
        }
        
        // 计算绝对时间
        const nextDepAbs = dayOffset * 1440 + flight.dep_minutes;
        const nextArrAbs = nextDepAbs + (flight.arr_minutes - flight.dep_minutes) + 
                           (flight.overnight ? 1440 : 0);
        
        // 检查后续航段（中转）的日期是否在限制期间
        // 666版本的中转航班也必须在限制期间外
        if (this.isDateRestricted(segmentDateStr, version)) {
          continue; // 跳过在限制期间的中转航段
        }
        
        // 检查中转时间约束
        const connectTime = nextDepAbs - lastSegment.arr_abs;
        
        if (connectTime < CONSTRAINTS.MIN_CONNECT_MINS || 
            connectTime > CONSTRAINTS.MAX_CONNECT_MINS) {
          continue;
        }
        
        // 检查总行程时间
        const totalDuration = nextArrAbs - node.segments[0].dep_abs;
        
        if (totalDuration > CONSTRAINTS.MAX_TOTAL_HOURS * 60) {
          continue;
        }
        
        // 完全移除剪枝逻辑
        
        // 创建新段
        const newSegment: InternalSegment = {
          flight,
          dep_abs: nextDepAbs,
          arr_abs: nextArrAbs,
          plus_day: dayOffset
        };
        
        expandCount++;
        
        // 如果到达目的地
        if (flight.dest_city === dest_city) {
          const route = this.createRoute([...node.segments, newSegment], date);
          routes.push(route);
          // 不再更新最佳到达时间
        } else if (node.segments.length < max_stops) {
          // 继续搜索
          const newVisited = new Set(node.visited_cities);
          newVisited.add(flight.dest_city);
          
          queue.push({
            segments: [...node.segments, newSegment],
            visited_cities: newVisited,
            arr_abs: nextArrAbs,
            total_duration: totalDuration
          });
        }
      }
    }
    
    // 排序并限制返回数量
    routes.sort((a, b) => {
      // 1. 最早到达
      const arrA = this.parseArrivalTime(a.arrive_time);
      const arrB = this.parseArrivalTime(b.arrive_time);
      if (arrA !== arrB) return arrA - arrB;
      
      // 2. 总时长最短
      if (a.total_duration_mins !== b.total_duration_mins) {
        return a.total_duration_mins - b.total_duration_mins;
      }
      
      // 3. 中转次数最少
      return a.stops - b.stops;
    });
    
    return { routes: routes.slice(0, CONSTRAINTS.MAX_ROUTES) };
  }
  
  // 创建路线对象
  private createRoute(segments: InternalSegment[], baseDate: string): Route {
    const route: Route = {
      stops: segments.length - 1,
      segments: [],
      connect_cities: [],
      arrive_time: '',
      total_duration_mins: 0
    };
    
    // 转换航段
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const depTime = formatAbsoluteTime(baseDate, seg.dep_abs);
      const arrTime = formatAbsoluteTime(baseDate, seg.arr_abs);
      
      route.segments.push({
        carrier_name: seg.flight.carrier_name,
        flight_no: seg.flight.flight_no,
        origin_city: seg.flight.origin_city,
        origin_airport: seg.flight.origin_airport,
        origin_iata_code: seg.flight.origin_iata_code,
        origin_province: seg.flight.origin_province,
        dest_city: seg.flight.dest_city,
        dest_airport: seg.flight.dest_airport,
        dest_iata_code: seg.flight.dest_iata_code,
        dest_province: seg.flight.dest_province,
        dep_time: depTime.dateTime,
        arr_time: arrTime.dateTime,
        plus_day: seg.plus_day
      });
      
      // 添加中转城市
      if (i < segments.length - 1) {
        route.connect_cities.push(seg.flight.dest_city);
      }
    }
    
    // 计算总时长和到达时间
    const lastSegment = segments[segments.length - 1];
    route.total_duration_mins = lastSegment.arr_abs - segments[0].dep_abs;
    route.arrive_time = formatArrivalTime(baseDate, lastSegment.arr_abs);
    
    // 检查是否存在返程直飞航班（仅对直飞航线检查）
    if (route.stops === 0) {
      const firstSegment = segments[0];
      const originCity = firstSegment.flight.origin_city;
      const destCity = lastSegment.flight.dest_city;
      route.hasReturn = flightDataService.hasDirectFlight(destCity, originCity);
    }
    
    return route;
  }
  
  // 解析到达时间用于排序
  private parseArrivalTime(arriveTime: string): number {
    // 解析 "HH:mm (+N)" 格式
    const match = arriveTime.match(/(\d{2}):(\d{2})(?:\s*\(\+(\d+)\))?/);
    if (!match) return 0;
    
    const hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const plusDays = match[3] ? parseInt(match[3]) : 0;
    
    return plusDays * 1440 + hours * 60 + minutes;
  }
}

// 创建单例实例
export const flightSearchService = new FlightSearchService();
